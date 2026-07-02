// TEST: Practice Profile ingestion + the first-run setup notice (custom buildout).
//
// The companion setup plugin (in Claude) is the WRITER: it interviews the user
// and writes the non-PHI Practice Profile into the user-override config.json
// under the `practiceProfile` namespace. The app is the READER. What we prove:
//   (a) validatePracticeProfile mirrors the JSON schema: valid profiles pass;
//       missing keys, extra keys, bad enums, and above all a tampered
//       `provisioning.aiEnabled: true` are rejected (AI never enabled by config),
//   (b) PracticeProfileStore over a REAL ConfigStore: no profile means not
//       onboarded; a plugin-written profile means onboarded; the default preset
//       alone (createdAt empty) never counts; corrupt values are treated absent,
//   (c) save() round-trips through config.json and refuses an invalid profile,
//   (d) SetupNoticeStore follows the FirstRunStore pattern: default
//       not-dismissed, dismissal persists, a corrupt flag file means show again,
//   (e) the shell seam end to end: with real deps wired through
//       registerShellHandlers, `setup:status` reports profile-missing (which is
//       what makes the renderer show the notice), dismissal flips only the
//       dismissed flag, a plugin-written profile flips profilePresent, and the
//       module registry advertises only the enabled subset.

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ConfigStore } from '../../src/main/config/configStore.js';
import { APP_DEFAULT_CONFIG } from '../../src/main/config/defaults.js';
import {
  PracticeProfileStore,
  validatePracticeProfile,
} from '../../src/main/practiceProfileStore.js';
import { SetupNoticeStore } from '../../src/main/setupNotice.js';
import { FirstRunStore } from '../../src/main/firstRun.js';
import { ApiKeyStore } from '../../src/main/secure/apiKeyStore.js';
import { ModuleHost } from '../../src/main/moduleHost.js';
import { registerShellHandlers } from '../../src/main/ipc/shellHandlers.js';
import { CHANNELS } from '../../src/shared/constants.js';
import type { IpcRouter, SetupStatus } from '../../src/shared/types/ipc.js';
import type { ModuleDescriptor, WorkflowModule } from '../../src/shared/types/module.js';
import type { PracticeProfile } from '../../src/shared/types/practiceProfile.js';
import { DEFAULT_PRACTICE_PROFILE } from '../../src/shared/types/practiceProfile.js';
import { tempDir, freshStore, fakeSealer } from '../helpers.js';

/** A COMPLETED profile, exactly what the setup plugin writes at the end of its
 * interview. All values are fictional and non-PHI (a business name, never a
 * client). */
function completedProfile(): PracticeProfile {
  return {
    schemaVersion: 1,
    createdAt: '2026-07-01T10:00:00.000Z',
    practiceName: 'Riverbend Counseling',
    practiceType: 'individual',
    careSetting: 'telehealth',
    noteFormat: 'DAP',
    billsInsurance: 'cash_pay',
    weeklyVolume: 'medium',
    wantsIntake: true,
    wantsScheduling: true,
    aiComfort: 'off_for_now',
    privacyPosture: 'maximum',
    provisioning: {
      enabledModules: ['notes', 'intake', 'scheduling'],
      appliedConfigs: { notes: 'DAP note format', intake: 'standard intake fields' },
      aiEnabled: false,
      completedAt: '2026-07-01T10:05:00.000Z',
    },
  };
}

describe('validatePracticeProfile (mirrors practiceProfile.schema.json)', () => {
  it('accepts a completed profile and the default preset', () => {
    expect(validatePracticeProfile(completedProfile())).toBe(true);
    expect(validatePracticeProfile(DEFAULT_PRACTICE_PROFILE)).toBe(true);
  });

  it('rejects non-objects and near-misses', () => {
    expect(validatePracticeProfile(null)).toBe(false);
    expect(validatePracticeProfile('profile')).toBe(false);
    expect(validatePracticeProfile([completedProfile()])).toBe(false);
    expect(validatePracticeProfile({})).toBe(false);
  });

  it('rejects a profile with a missing required key', () => {
    const p = completedProfile() as unknown as Record<string, unknown>;
    delete p.noteFormat;
    expect(validatePracticeProfile(p)).toBe(false);
  });

  it('rejects extra keys (additionalProperties: false), top level and nested', () => {
    const top = { ...completedProfile(), clientList: [] } as unknown;
    expect(validatePracticeProfile(top)).toBe(false);
    const base = completedProfile();
    const nested = {
      ...base,
      provisioning: { ...base.provisioning, extra: true },
    } as unknown;
    expect(validatePracticeProfile(nested)).toBe(false);
  });

  it('rejects bad enum values and malformed fields', () => {
    expect(validatePracticeProfile({ ...completedProfile(), noteFormat: 'FREEFORM' })).toBe(false);
    expect(validatePracticeProfile({ ...completedProfile(), practiceType: 'huge' })).toBe(false);
    expect(validatePracticeProfile({ ...completedProfile(), schemaVersion: 0 })).toBe(false);
    expect(validatePracticeProfile({ ...completedProfile(), practiceName: 'x'.repeat(121) })).toBe(
      false
    );
    const base = completedProfile();
    const dupMods = {
      ...base,
      provisioning: { ...base.provisioning, enabledModules: ['notes', 'notes'] },
    } as unknown;
    expect(validatePracticeProfile(dupMods)).toBe(false);
  });

  it('LOAD-BEARING: rejects any profile where provisioning.aiEnabled is not the literal false', () => {
    const base = completedProfile();
    for (const bad of [true, 'false', 0, null, undefined]) {
      const tampered = {
        ...base,
        provisioning: { ...base.provisioning, aiEnabled: bad },
      } as unknown;
      expect(validatePracticeProfile(tampered)).toBe(false);
    }
  });
});

describe('PracticeProfileStore over a real ConfigStore', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function fixture(overridesJson?: string): { config: ConfigStore; configPath: string } {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const configPath = join(dir, 'config.json');
    if (overridesJson !== undefined) writeFileSync(configPath, overridesJson, { mode: 0o600 });
    return { config: new ConfigStore({ defaults: APP_DEFAULT_CONFIG, configPath }), configPath };
  }

  it('no profile in config: get() is null and isOnboarded() is false', () => {
    const { config } = fixture();
    const store = new PracticeProfileStore(config);
    expect(store.get()).toBeNull();
    expect(store.isOnboarded()).toBe(false);
  });

  it('a plugin-written profile in config.json makes the app onboarded', () => {
    const { config } = fixture(JSON.stringify({ practiceProfile: completedProfile() }));
    const store = new PracticeProfileStore(config);
    expect(store.isOnboarded()).toBe(true);
    expect(store.get()?.practiceName).toBe('Riverbend Counseling');
    expect(store.get()?.provisioning.aiEnabled).toBe(false);
  });

  it('the default preset alone (createdAt empty) never counts as onboarded', () => {
    const { config } = fixture(JSON.stringify({ practiceProfile: DEFAULT_PRACTICE_PROFILE }));
    const store = new PracticeProfileStore(config);
    expect(store.get()).toBeNull();
    expect(store.isOnboarded()).toBe(false);
  });

  it('a corrupt or tampered stored profile is treated as absent (fail safe)', () => {
    // wrong type entirely
    const a = new PracticeProfileStore(
      fixture(JSON.stringify({ practiceProfile: 'not an object' })).config
    );
    expect(a.isOnboarded()).toBe(false);
    // structurally valid JSON but tampered aiEnabled
    const base = completedProfile();
    const tampered = { ...base, provisioning: { ...base.provisioning, aiEnabled: true } };
    const b = new PracticeProfileStore(
      fixture(JSON.stringify({ practiceProfile: tampered })).config
    );
    expect(b.isOnboarded()).toBe(false);
    expect(b.get()).toBeNull();
  });

  it('save() round-trips: persists to config.json and a fresh store reads it back', () => {
    const { config, configPath } = fixture();
    const store = new PracticeProfileStore(config);
    store.save(completedProfile());

    // on disk, in the user-override layer
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(raw.practiceProfile).toBeDefined();

    // a brand-new ConfigStore + profile store (fresh process) reads it back
    const config2 = new ConfigStore({ defaults: APP_DEFAULT_CONFIG, configPath });
    const store2 = new PracticeProfileStore(config2);
    expect(store2.isOnboarded()).toBe(true);
    expect(store2.get()).toEqual(completedProfile());
  });

  it('save() refuses an invalid profile with code PROFILE_INVALID and writes nothing', () => {
    const { config } = fixture();
    const store = new PracticeProfileStore(config);
    const base = completedProfile();
    const bad = {
      ...base,
      provisioning: { ...base.provisioning, aiEnabled: true },
    } as unknown as PracticeProfile;

    let caught: unknown;
    try {
      store.save(bad);
    } catch (e) {
      caught = e;
    }
    expect((caught as NodeJS.ErrnoException | undefined)?.code).toBe('PROFILE_INVALID');
    expect(store.isOnboarded()).toBe(false);
    expect(config.get('practiceProfile')).toBeUndefined();
  });

  it('default() hands out an independent copy of the preset', () => {
    const { config } = fixture();
    const store = new PracticeProfileStore(config);
    const d = store.default();
    d.practiceName = 'mutated';
    expect(store.default().practiceName).toBe('');
    expect(DEFAULT_PRACTICE_PROFILE.practiceName).toBe('');
  });
});

describe('SetupNoticeStore (FirstRunStore pattern)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it('defaults to not dismissed when no flag file exists', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const store = new SetupNoticeStore(join(dir, 'setupnotice.json'));
    expect(store.status()).toEqual({ dismissed: false });
  });

  it('dismiss() persists across store instances (i.e. app restarts)', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const path = join(dir, 'setupnotice.json');
    new SetupNoticeStore(path).dismiss();
    expect(new SetupNoticeStore(path).status().dismissed).toBe(true);
  });

  it('a corrupt flag file means not dismissed (the notice simply shows again)', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const path = join(dir, 'setupnotice.json');
    writeFileSync(path, '{{ definitely not json', { mode: 0o600 });
    expect(new SetupNoticeStore(path).status().dismissed).toBe(false);
  });
});

describe('shell seam: setup:status drives the notice (profile-missing shows it)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  /** A router that records handlers so the test can invoke them like the
   * renderer would. */
  function recordingRouter(): {
    router: IpcRouter;
    invoke: <T>(channel: string, req?: unknown) => Promise<T>;
  } {
    const handlers = new Map<string, (req: unknown) => unknown>();
    const router: IpcRouter = {
      handle<TReq, TRes>(channel: string, fn: (req: TReq) => Promise<TRes> | TRes): void {
        handlers.set(channel, fn as (req: unknown) => unknown);
      },
    };
    return {
      router,
      invoke: async <T>(channel: string, req?: unknown): Promise<T> => {
        const fn = handlers.get(channel);
        if (!fn) throw new Error(`no handler registered for ${channel}`);
        return (await fn(req)) as T;
      },
    };
  }

  function fakeModule(id: string, title: string): WorkflowModule {
    return { id, title, functional: true };
  }

  /** Wire registerShellHandlers with REAL deps (encrypted store, config store,
   * sealed key store, flag stores) exactly like bootSpine does, minus Electron. */
  function shellFixture() {
    const { store, dbPath, dir, cleanup } = freshStore();
    cleanups.push(cleanup);
    const config = new ConfigStore({
      defaults: APP_DEFAULT_CONFIG,
      configPath: join(dir, 'config.json'),
    });
    const practiceProfile = new PracticeProfileStore(config);
    const setupNotice = new SetupNoticeStore(join(dir, 'setupnotice.json'));
    const host = new ModuleHost([
      fakeModule('notes', 'Session Notes'),
      fakeModule('intake', 'Intake'),
      fakeModule('scheduling', 'Scheduling'),
      fakeModule('billing', 'Billing'),
    ]);
    const { router, invoke } = recordingRouter();
    registerShellHandlers(router, {
      store,
      config,
      apiKey: new ApiKeyStore(join(dir, 'apikey.sealed'), fakeSealer()),
      firstRun: new FirstRunStore(join(dir, 'firstrun.json')),
      practiceProfile,
      setupNotice,
      host,
      enabledModules: ['notes', 'scheduling'],
      dataMode: () => 'synthetic' as const,
      dbKey: randomBytes(32),
      dbPath,
      blobDir: join(dir, 'blobs'),
    });
    return { invoke, config };
  }

  it('before any profile exists, setup:status says so (renderer shows the notice)', async () => {
    const { invoke } = shellFixture();
    const status = await invoke<SetupStatus>(CHANNELS.setupStatus);
    expect(status).toEqual({ profilePresent: false, noticeDismissed: false });
  });

  it('dismissing flips only the dismissed flag; the profile is still absent', async () => {
    const { invoke } = shellFixture();
    await invoke(CHANNELS.setupDismissNotice);
    const status = await invoke<SetupStatus>(CHANNELS.setupStatus);
    expect(status).toEqual({ profilePresent: false, noticeDismissed: true });
  });

  it('once the plugin writes a profile, setup:status reports it present', async () => {
    const { invoke, config } = shellFixture();
    // the plugin writes the profile into the user-override config layer
    config.set('practiceProfile', completedProfile());
    const status = await invoke<SetupStatus>(CHANNELS.setupStatus);
    expect(status.profilePresent).toBe(true);
  });

  it('the module registry advertises only the enabled subset (plus notes)', async () => {
    const { invoke } = shellFixture();
    const mods = await invoke<ModuleDescriptor[]>(CHANNELS.moduleRegistry);
    expect(mods.map((m) => m.id)).toEqual(['notes', 'scheduling']);
  });
});
