// TEST: the config-driven module enablement filter (custom buildout).
//
// The companion setup plugin provisions the app by writing the non-PHI config
// key `app.enabledModules`; the composition root filters which compiled modules
// are HOSTED (IPC registered) and ADVERTISED (descriptors) through ModuleHost.
// What we prove:
//   (a) an enabled subset is hosted and advertised; a disabled module is neither,
//   (b) notes is ALWAYS kept, even for an empty or nonsense allowlist,
//   (c) a missing or corrupt `app.enabledModules` value falls back to all four
//       modules (resolveEnabledModules never narrows on bad input),
//   (d) the legacy unfiltered methods (registerAll / descriptors) are unchanged,
//   (e) through a REAL ConfigStore: defaults keep all four on; a provisioned
//       (user-override) narrow set narrows; a corrupt config.json file falls
//       back to defaults, i.e. all four stay on.

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ModuleHost,
  resolveEnabledModules,
  DEFAULT_ENABLED_MODULES,
} from '../../src/main/moduleHost.js';
import { APP_DEFAULT_CONFIG } from '../../src/main/config/defaults.js';
import { ConfigStore } from '../../src/main/config/configStore.js';
import type { WorkflowModule } from '../../src/shared/types/module.js';
import type { IpcRouter } from '../../src/shared/types/ipc.js';
import { tempDir } from '../helpers.js';

/** A minimal fake module whose IPC registration we can observe. */
function fakeModule(id: string, title: string): WorkflowModule {
  return {
    id,
    title,
    functional: true,
    registerIpc(router: IpcRouter): void {
      router.handle(`${id}:ping`, () => 'pong');
    },
  };
}

/** A fake router that records which channels got a handler. */
function fakeRouter(): { router: IpcRouter; channels: string[] } {
  const channels: string[] = [];
  const router: IpcRouter = {
    handle(channel: string): void {
      channels.push(channel);
    },
  };
  return { router, channels };
}

const ALL = ['notes', 'intake', 'scheduling', 'billing'];

function hostWithAllFour(): ModuleHost {
  return new ModuleHost([
    fakeModule('notes', 'Session Notes'),
    fakeModule('intake', 'Intake'),
    fakeModule('scheduling', 'Scheduling'),
    fakeModule('billing', 'Billing'),
  ]);
}

describe('ModuleHost enablement filter', () => {
  it('(a) hosts and advertises only the enabled subset', () => {
    const host = hostWithAllFour();
    const { router, channels } = fakeRouter();

    host.registerEnabled(router, ['notes', 'scheduling']);
    expect(channels).toContain('notes:ping');
    expect(channels).toContain('scheduling:ping');
    expect(channels).not.toContain('intake:ping');
    expect(channels).not.toContain('billing:ping');

    const ids = host.enabledDescriptors(['notes', 'scheduling']).map((d) => d.id);
    expect(ids).toEqual(['notes', 'scheduling']);
  });

  it('(a) a disabled module is not advertised in the descriptors', () => {
    const host = hostWithAllFour();
    const ids = host.enabledDescriptors(['notes', 'intake', 'scheduling']).map((d) => d.id);
    expect(ids).not.toContain('billing');
    expect(ids).toHaveLength(3);
  });

  it('(b) notes is always kept, even for an empty or nonsense allowlist', () => {
    const host = hostWithAllFour();
    expect(host.enabledDescriptors([]).map((d) => d.id)).toEqual(['notes']);
    expect(host.enabledDescriptors(['no-such-module']).map((d) => d.id)).toEqual(['notes']);
    // billing-only still keeps notes alongside billing
    expect(host.enabledDescriptors(['billing']).map((d) => d.id)).toEqual(['notes', 'billing']);

    const { router, channels } = fakeRouter();
    host.registerEnabled(router, []);
    expect(channels).toEqual(['notes:ping']);
  });

  it('(d) the legacy unfiltered methods still host and advertise everything', () => {
    const host = hostWithAllFour();
    expect(host.descriptors().map((d) => d.id)).toEqual(ALL);
    const { router, channels } = fakeRouter();
    host.registerAll(router);
    expect(channels).toHaveLength(4);
  });
});

describe('resolveEnabledModules (missing / corrupt fallback)', () => {
  it('(c) missing value falls back to all four modules', () => {
    expect(resolveEnabledModules(undefined)).toEqual(ALL);
    expect(resolveEnabledModules(null)).toEqual(ALL);
  });

  it('(c) corrupt values (wrong type, mixed array) fall back to all four', () => {
    expect(resolveEnabledModules('notes')).toEqual(ALL);
    expect(resolveEnabledModules(42)).toEqual(ALL);
    expect(resolveEnabledModules({ notes: true })).toEqual(ALL);
    expect(resolveEnabledModules(['notes', 7])).toEqual(ALL);
  });

  it('passes a valid narrow list through untouched', () => {
    expect(resolveEnabledModules(['notes', 'billing'])).toEqual(['notes', 'billing']);
    // an explicit empty array is honored (the host still keeps notes on)
    expect(resolveEnabledModules([])).toEqual([]);
  });

  it('the exported default matches the baked config default', () => {
    expect([...DEFAULT_ENABLED_MODULES]).toEqual(ALL);
    const app = APP_DEFAULT_CONFIG.app as Record<string, unknown>;
    expect(app.enabledModules).toEqual(ALL);
  });
});

describe('enablement through a real ConfigStore', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function configIn(dir: string): string {
    return join(dir, 'config.json');
  }

  it('un-provisioned (no overrides file): all four modules enabled', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const config = new ConfigStore({ defaults: APP_DEFAULT_CONFIG, configPath: configIn(dir) });
    const enabled = resolveEnabledModules(config.get('app.enabledModules'));
    expect(enabled).toEqual(ALL);
  });

  it('provisioned narrow set (what the setup plugin writes) narrows the host', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    // the setup plugin writes the user-override config.json directly
    writeFileSync(
      configIn(dir),
      JSON.stringify({ app: { enabledModules: ['notes', 'intake', 'scheduling'] } }),
      { mode: 0o600 }
    );
    const config = new ConfigStore({ defaults: APP_DEFAULT_CONFIG, configPath: configIn(dir) });
    const enabled = resolveEnabledModules(config.get('app.enabledModules'));
    const host = hostWithAllFour();
    const ids = host.enabledDescriptors(enabled).map((d) => d.id);
    expect(ids).toEqual(['notes', 'intake', 'scheduling']);
    expect(ids).not.toContain('billing');
  });

  it('corrupt config.json falls back to defaults: all four stay enabled', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    writeFileSync(configIn(dir), 'this is not json {{{', { mode: 0o600 });
    const config = new ConfigStore({ defaults: APP_DEFAULT_CONFIG, configPath: configIn(dir) });
    const enabled = resolveEnabledModules(config.get('app.enabledModules'));
    expect(enabled).toEqual(ALL);
  });

  it('corrupt VALUE under the right key also falls back to all four', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    writeFileSync(configIn(dir), JSON.stringify({ app: { enabledModules: 'billing' } }), {
      mode: 0o600,
    });
    const config = new ConfigStore({ defaults: APP_DEFAULT_CONFIG, configPath: configIn(dir) });
    const enabled = resolveEnabledModules(config.get('app.enabledModules'));
    expect(enabled).toEqual(ALL);
  });
});
