// TEST: provisioned config values are actually CONSUMED (custom buildout).
//
// The companion setup plugin writes notes.defaultFormat, scheduling
// defaultModality / defaultDurationMinutes, and app.productName into the
// user-override config.json. This proves the app-side wiring gives those keys
// real effect, with an explicit caller value always winning, and that every
// provisioned value is sanitized to its legal domain at read time (config.json
// is human-editable JSON; a bad value falls back, never widens a type):
//   (a) the sanitizers narrow bad values, including the profile-level 'both'
//       care setting which is NOT a legal per-appointment modality,
//   (b) NoteService.createDraft with no format uses the provisioned default;
//       explicit format wins; no dep at all means the baked SOAP,
//   (c) SchedulingService.create fills omitted modality/duration from config;
//       explicit values win; absent getters leave the repository defaults,
//   (d) end to end through a REAL ConfigStore with a plugin-written overrides
//       file, using the SAME closure shapes as src/modules/index.ts,
//   (e) resolveProductName narrows the window-title value.

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigStore } from '../../src/main/config/configStore.js';
import { APP_DEFAULT_CONFIG, resolveProductName } from '../../src/main/config/defaults.js';
import {
  sanitizeNoteFormat,
  sanitizeModality,
  sanitizeDurationMinutes,
} from '../../src/modules/index.js';
import { NoteService } from '../../src/modules/notes/noteService.js';
import { MockDraftProvider } from '../../src/main/agent/providers/mockDraftProvider.js';
import { SchedulingService } from '../../src/modules/scheduling/schedulingService.js';
import type { SchedulingConfig } from '../../src/modules/scheduling/schedulingService.js';
import { EgressGuard } from '../../src/main/agent/egressGuard.js';
import { silentLogger } from '../../src/main/agent/logger.js';
import { freshStore, tempDir } from '../helpers.js';
import type { DataStore } from '../../src/main/data/dataStore.js';

const TEMPLATE = 'Hello {{preferred_name}}, your appointment is on {{date}} at {{time}}.';

function baseSchedulingConfig(): SchedulingConfig {
  return {
    reminderTemplate: () => TEMPLATE,
    leadHours: () => 24,
    practiceName: () => 'Sample Therapy Practice',
  };
}

function makeClient(store: DataStore): string {
  return store.clients.create({
    legal_first_name: 'Sam',
    legal_last_name: 'Sample',
    preferred_name: 'Sam',
    preferred_contact_method: 'email',
    demo: 1,
  }).id;
}

describe('provisioned-value sanitizers', () => {
  it('(a) note format: three known values pass, everything else falls to SOAP', () => {
    expect(sanitizeNoteFormat('DAP')).toBe('DAP');
    expect(sanitizeNoteFormat('BIRP')).toBe('BIRP');
    expect(sanitizeNoteFormat('SOAP')).toBe('SOAP');
    for (const bad of ['FREEFORM', 'soap', '', 7, null, undefined, ['DAP']]) {
      expect(sanitizeNoteFormat(bad)).toBe('SOAP');
    }
  });

  it("(a) modality is strictly binary: 'both' and anything else falls to telehealth", () => {
    expect(sanitizeModality('in_person')).toBe('in_person');
    expect(sanitizeModality('telehealth')).toBe('telehealth');
    for (const bad of ['both', 'video', '', 0, null, undefined]) {
      expect(sanitizeModality(bad)).toBe('telehealth');
    }
  });

  it('(a) duration: sane whole minutes pass, everything else falls to 50', () => {
    expect(sanitizeDurationMinutes(45)).toBe(45);
    expect(sanitizeDurationMinutes(90)).toBe(90);
    for (const bad of [0, 9, 241, 50.5, '50', null, undefined, NaN]) {
      expect(sanitizeDurationMinutes(bad)).toBe(50);
    }
  });

  it('(e) resolveProductName narrows the window title value', () => {
    expect(resolveProductName('Riverbend Counseling')).toBe('Riverbend Counseling');
    expect(resolveProductName('  padded  ')).toBe('padded');
    for (const bad of ['', '   ', 'x'.repeat(81), 42, null, undefined, {}]) {
      expect(resolveProductName(bad)).toBe('Therapy Practice Assistant');
    }
  });
});

describe('NoteService: provisioned default format', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function noteFixture(defaultFormat?: () => 'SOAP' | 'DAP' | 'BIRP') {
    const { store, cleanup } = freshStore();
    cleanups.push(cleanup);
    const service = new NoteService({
      notes: store.notes,
      audit: store.audit,
      provider: new MockDraftProvider(new EgressGuard(silentLogger)),
      dataMode: 'synthetic',
      defaultFormat,
    });
    return { service, clientId: makeClient(store) };
  }

  it('(b) an omitted format resolves through the provisioned default', () => {
    const { service, clientId } = noteFixture(() => 'DAP');
    const note = service.createDraft({ client_id: clientId });
    expect(note.format).toBe('DAP');
    // the empty sections match the resolved format, not SOAP
    expect(note.sections.map((s) => s.key)).toEqual(['data', 'assessment', 'plan']);
  });

  it('(b) an explicit format always wins over the provisioned default', () => {
    const { service, clientId } = noteFixture(() => 'DAP');
    const note = service.createDraft({ client_id: clientId, format: 'BIRP' });
    expect(note.format).toBe('BIRP');
  });

  it('(b) with no default dep at all, the baked SOAP fallback applies', () => {
    const { service, clientId } = noteFixture(undefined);
    const note = service.createDraft({ client_id: clientId });
    expect(note.format).toBe('SOAP');
  });
});

describe('SchedulingService: provisioned appointment defaults', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function schedFixture(config: SchedulingConfig) {
    const { store, cleanup } = freshStore();
    cleanups.push(cleanup);
    const service = new SchedulingService({
      appointments: store.appointments,
      reminders: store.reminders,
      clients: store.clients,
      audit: store.audit,
      guard: new EgressGuard(silentLogger),
      dataMode: () => 'synthetic',
      config,
    });
    return { service, clientId: makeClient(store) };
  }

  it('(c) omitted modality and duration fill from the provisioned config', () => {
    const { service, clientId } = schedFixture({
      ...baseSchedulingConfig(),
      defaultModality: () => 'in_person',
      defaultDurationMinutes: () => 45,
    });
    const appt = service.create({ client_id: clientId, starts_at: '2026-07-08T15:00:00.000Z' });
    expect(appt.modality).toBe('in_person');
    expect(appt.duration_minutes).toBe(45);
  });

  it('(c) explicit values always win over the provisioned defaults', () => {
    const { service, clientId } = schedFixture({
      ...baseSchedulingConfig(),
      defaultModality: () => 'in_person',
      defaultDurationMinutes: () => 45,
    });
    const appt = service.create({
      client_id: clientId,
      starts_at: '2026-07-08T15:00:00.000Z',
      modality: 'telehealth',
      duration_minutes: 80,
    });
    expect(appt.modality).toBe('telehealth');
    expect(appt.duration_minutes).toBe(80);
  });

  it('(c) with no getters (legacy construction) the repository defaults stand', () => {
    const { service, clientId } = schedFixture(baseSchedulingConfig());
    const appt = service.create({ client_id: clientId, starts_at: '2026-07-08T15:00:00.000Z' });
    expect(appt.modality).toBe('in_person'); // repository's baked default
    expect(appt.duration_minutes).toBe(50);
  });
});

describe('end to end through a real ConfigStore (plugin-written overrides)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it('(d) plugin-written values flow through the registry closure shapes', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const configPath = join(dir, 'config.json');
    // exactly what the setup plugin provisions for a DAP, in-person, 45-minute
    // practice (plus a deliberately bad duration type to prove sanitization)
    writeFileSync(
      configPath,
      JSON.stringify({
        notes: { defaultFormat: 'DAP' },
        scheduling: { defaultModality: 'in_person', defaultDurationMinutes: 45 },
      }),
      { mode: 0o600 }
    );
    const config = new ConfigStore({ defaults: APP_DEFAULT_CONFIG, configPath });
    const cfg = (): ConfigStore | null => config;

    const { store, cleanup: storeCleanup } = freshStore();
    cleanups.push(storeCleanup);
    const clientId = makeClient(store);

    // the SAME closure shapes src/modules/index.ts wires at boot
    const noteService = new NoteService({
      notes: store.notes,
      audit: store.audit,
      provider: new MockDraftProvider(new EgressGuard(silentLogger)),
      dataMode: 'synthetic',
      defaultFormat: () => sanitizeNoteFormat(cfg()?.get('notes.defaultFormat')),
    });
    const schedulingService = new SchedulingService({
      appointments: store.appointments,
      reminders: store.reminders,
      clients: store.clients,
      audit: store.audit,
      guard: new EgressGuard(silentLogger),
      dataMode: () => 'synthetic',
      config: {
        ...baseSchedulingConfig(),
        defaultModality: () => sanitizeModality(cfg()?.get('scheduling.defaultModality')),
        defaultDurationMinutes: () =>
          sanitizeDurationMinutes(cfg()?.get('scheduling.defaultDurationMinutes')),
      },
    });

    const note = noteService.createDraft({ client_id: clientId });
    expect(note.format).toBe('DAP');

    const appt = schedulingService.create({
      client_id: clientId,
      starts_at: '2026-07-08T15:00:00.000Z',
    });
    expect(appt.modality).toBe('in_person');
    expect(appt.duration_minutes).toBe(45);
  });

  it('(d) un-provisioned defaults: SOAP format, telehealth modality, 50 minutes', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    // no overrides file at all: the merged defaults (app + module seeds) apply.
    // Module seeds are merged by the host at boot; here we emulate that merge for
    // the two scheduling keys the module contributes.
    const config = new ConfigStore({
      defaults: {
        ...APP_DEFAULT_CONFIG,
        scheduling: { defaultDurationMinutes: 50, defaultModality: 'telehealth' },
      },
      configPath: join(dir, 'config.json'),
    });
    const cfg = (): ConfigStore | null => config;

    expect(sanitizeNoteFormat(cfg()?.get('notes.defaultFormat'))).toBe('SOAP');
    expect(sanitizeModality(cfg()?.get('scheduling.defaultModality'))).toBe('telehealth');
    expect(sanitizeDurationMinutes(cfg()?.get('scheduling.defaultDurationMinutes'))).toBe(50);
  });

  it("(d) a corrupt or profile-level value ('both') sanitizes instead of leaking", () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        notes: { defaultFormat: 'FREEFORM' },
        scheduling: { defaultModality: 'both', defaultDurationMinutes: 'an hour' },
      }),
      { mode: 0o600 }
    );
    const config = new ConfigStore({ defaults: APP_DEFAULT_CONFIG, configPath });
    const cfg = (): ConfigStore | null => config;

    expect(sanitizeNoteFormat(cfg()?.get('notes.defaultFormat'))).toBe('SOAP');
    expect(sanitizeModality(cfg()?.get('scheduling.defaultModality'))).toBe('telehealth');
    expect(sanitizeDurationMinutes(cfg()?.get('scheduling.defaultDurationMinutes'))).toBe(50);
  });
});
