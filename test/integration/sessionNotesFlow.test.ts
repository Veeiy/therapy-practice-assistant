// INTEGRATION TEST: the full session-notes workflow (#1 of 4), end to end, over the
// real service + repository + provider + guard stack on an encrypted DB.
//
// This is the workflow the brief asks to be FUNCTIONAL this wave. It exercises the
// whole spine on the synthetic path:
//
//   seedSynthetic  ->  a real (fictional) client + completed appointment exist
//   createDraft    ->  a SOAP draft with empty sections
//   requestDraft   ->  the Mock provider (through the EgressGuard) fills sections
//                      from shorthand, sets ai_assisted, records an audit row
//   saveSections   ->  the therapist edits a section (draft is mutable)
//   sign           ->  draft -> signed; the note locks (F2)
//   [locked]       ->  saveSections / requestDraft now throw NOTE_IMMUTABLE
//   addAddendum    ->  an append-only correction is still allowed after signing
//
// Along the way it asserts the invariants that matter:
//  * the persisted note is encrypted at rest (we re-read the .db bytes and the note
//    text is NOT present as plaintext),
//  * no drafted/edited text carries a prohibited dash (F5),
//  * the audit trail is metadata-only: it records the lifecycle actions but never
//    the note body, shorthand, or any identifier (F4),
//  * the whole thing runs offline with no API key and no network (Mock provider).

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDataStore, type DataStore } from '../../src/main/data/dataStore.js';
import { seedSynthetic } from '../../src/main/data/seedSynthetic.js';
import { NoteService } from '../../src/modules/notes/noteService.js';
import { MockDraftProvider } from '../../src/main/agent/providers/mockDraftProvider.js';
import { EgressGuard } from '../../src/main/agent/egressGuard.js';
import { silentLogger } from '../../src/main/agent/logger.js';
import { hasProhibitedDash } from '../../src/main/agent/textPostProcess.js';
import { ERROR_CODES } from '../../src/shared/constants.js';
import { tempDir, fakeClock, fakeIds } from '../helpers.js';

describe('session-notes flow (workflow 1, integration)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function setup() {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const dbPath = join(dir, 'practice.db');
    const store: DataStore = openDataStore({
      dbPath,
      key: randomBytes(32),
      clock: fakeClock(),
      ids: fakeIds(),
    });
    cleanups.push(() => store.close());

    const guard = new EgressGuard(silentLogger);
    const provider = new MockDraftProvider(guard);
    const service = new NoteService({
      notes: store.notes,
      audit: store.audit,
      provider,
      dataMode: 'synthetic',
    });
    return { dir, dbPath, store, service };
  }

  it('composes -> mock-drafts -> edits -> signs -> locks -> addendum', async () => {
    const { dbPath, store, service } = setup();

    // seed obviously-fictional data (hard rule 4); use the demo client + appointment
    const seed = seedSynthetic(store);
    const clientId = seed.clientIds[0];
    const appointmentId = seed.appointmentIds[0];
    expect(store.clients.get(clientId)!.legal_last_name).toBe('Sample'); // fictional

    // 1) create a SOAP draft
    const draft = service.createDraft({
      client_id: clientId,
      appointment_id: appointmentId,
      format: 'SOAP',
      modality: 'telehealth',
      demo: 1,
    });
    expect(draft.status).toBe('draft');
    expect(draft.sections.map((s) => s.key)).toEqual([
      'subjective',
      'objective',
      'assessment',
      'plan',
    ]);
    expect(draft.sections.every((s) => s.body === '')).toBe(true);

    // 2) request an AI draft from shorthand (Mock provider, offline, via the guard)
    const SHORTHAND =
      'client discussed work stress and poor sleep; practiced paced breathing; agreed to a sleep log';
    const drafted = await service.requestDraft({
      note_id: draft.id,
      shorthand: SHORTHAND,
      cues: { modality: 'telehealth', homeworkAssigned: true, sessionNumber: 4 },
    });
    expect(drafted.ai_assisted).toBe(true);
    expect(drafted.shorthand_input).toBe(SHORTHAND);
    // every section now has body text, and none carries a prohibited dash (F5)
    expect(drafted.sections.every((s) => s.body.length > 0)).toBe(true);
    for (const s of drafted.sections) expect(hasProhibitedDash(s.body)).toBe(false);

    // 3) therapist edits the Subjective section (draft is mutable)
    const editedSections = drafted.sections.map((s) =>
      s.key === 'subjective' ? { ...s, body: 'Client reported improved sleep this week.' } : s
    );
    const edited = service.saveSections(draft.id, editedSections);
    expect(edited.sections.find((s) => s.key === 'subjective')!.body).toBe(
      'Client reported improved sleep this week.'
    );
    expect(edited.status).toBe('draft');

    // 4) sign -> the note locks (F2)
    const signed = service.sign(draft.id, 'Therapist');
    expect(signed.status).toBe('signed');
    expect(signed.signed_at).not.toBeNull();

    // 5) locked: editing or re-drafting now throws NOTE_IMMUTABLE
    expect(() => service.saveSections(draft.id, editedSections)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.NOTE_IMMUTABLE })
    );
    await expect(
      service.requestDraft({ note_id: draft.id, shorthand: 'try again' })
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOTE_IMMUTABLE' }));

    // 6) addendum is still allowed (the sanctioned correction path)
    const add = service.addAddendum(draft.id, 'Therapist', 'Follow-up: client emailed an update.');
    const view = service.get(draft.id)!;
    expect(view.note.status).toBe('signed');
    expect(view.addenda).toHaveLength(1);
    expect(view.addenda[0].id).toBe(add.id);

    // ---- cross-cutting invariants -------------------------------------------

    // encryption at rest: the edited sentence must NOT appear as plaintext on disk.
    store.close();
    const raw = readFileSync(dbPath);
    expect(raw.includes(Buffer.from('Client reported improved sleep this week.'))).toBe(false);
    expect(raw.includes(Buffer.from(SHORTHAND))).toBe(false);
    expect(raw.subarray(0, 16).toString('utf8')).not.toContain('SQLite format 3');
  });

  it('audit trail records lifecycle ACTIONS but never note body, shorthand, or identifiers (F4)', async () => {
    const { store, service } = setup();
    const seed = seedSynthetic(store);
    const clientId = seed.clientIds[0];

    const draft = service.createDraft({ client_id: clientId, format: 'DAP', demo: 1 });
    const SHORTHAND = 'sensitive content: client mentioned email sam.sample@example.com and a phone 555-123-4567';
    await service.requestDraft({ note_id: draft.id, shorthand: SHORTHAND });
    service.sign(draft.id, 'Therapist');
    service.addAddendum(draft.id, 'Therapist', 'a correction with detail');

    const rows = store.audit.recent(50);
    const actions = rows.map((r) => r.action);
    // the lifecycle was recorded
    expect(actions).toContain('note_create_draft');
    expect(actions).toContain('note_ai_draft');
    expect(actions).toContain('note_sign');
    expect(actions).toContain('note_addendum');

    // but NO row's summary leaks body text, shorthand, or an identifier
    for (const r of rows) {
      const s = r.summary ?? '';
      expect(s).not.toContain('sam.sample@example.com');
      expect(s).not.toContain('555-123-4567');
      expect(s).not.toContain('sensitive content');
      expect(s).not.toContain('a correction with detail');
    }
  });
});
