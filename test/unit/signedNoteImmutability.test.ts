// TEST: signed-note immutability (F2), proven at BOTH layers on the SAME predicate.
//
// F2 says a signed note is immutable, enforced on one canonical predicate
// (status = 'signed') in two places that must agree:
//   (1) the SQL TRIGGER in 0001_init.sql  -> storage-level, cannot be bypassed,
//   (2) NotesRepository.assertMutable()    -> app-level, throws NOTE_IMMUTABLE.
//
// We prove:
//  (a) a DRAFT note can be edited and signed,
//  (b) after signing, the app layer refuses updateDraft/sign with code
//      NOTE_IMMUTABLE (the friendly, branchable error),
//  (c) the storage TRIGGER also refuses a RAW UPDATE/DELETE that tries to go around
//      the repository (so even a future code path cannot mutate a signed row),
//  (d) addenda are still allowed after signing (the sanctioned correction path),
//  (e) the addendum table is itself append-only (its own triggers fire).

import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDataStore, type DataStore } from '../../src/main/data/dataStore.js';
import { ERROR_CODES } from '../../src/shared/constants.js';
import { tempDir, fakeClock, fakeIds } from '../helpers.js';

describe('signed-note immutability (F2)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function freshStore(): DataStore {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const store = openDataStore({
      dbPath: join(dir, 'practice.db'),
      key: randomBytes(32),
      clock: fakeClock(),
      ids: fakeIds(),
    });
    cleanups.push(() => store.close());
    return store;
  }

  function seedClientAndDraft(store: DataStore) {
    const client = store.clients.create({
      legal_first_name: 'Sam',
      legal_last_name: 'Sample',
      demo: 1,
    });
    const note = store.notes.create({
      client_id: client.id,
      format: 'SOAP',
      sections: [
        { key: 'subjective', label: 'Subjective', body: '' },
        { key: 'objective', label: 'Objective', body: '' },
        { key: 'assessment', label: 'Assessment', body: '' },
        { key: 'plan', label: 'Plan', body: '' },
      ],
      demo: 1,
    });
    return { client, note };
  }

  it('allows editing a draft, then locks it on sign (app layer)', () => {
    const store = freshStore();
    const { note } = seedClientAndDraft(store);

    // (a) draft is editable
    const edited = store.notes.updateDraft(note.id, {
      sections: [{ key: 'subjective', label: 'Subjective', body: 'Draft body.' }],
    });
    expect(edited.status).toBe('draft');
    expect(edited.sections[0].body).toBe('Draft body.');

    // sign it
    const signed = store.notes.sign(note.id, 'Therapist');
    expect(signed.status).toBe('signed');
    expect(signed.signed_by).toBe('Therapist');
    expect(signed.signed_at).not.toBeNull();

    // (b) the app layer refuses further edits with the branchable code
    expect(() =>
      store.notes.updateDraft(note.id, {
        sections: [{ key: 'subjective', label: 'Subjective', body: 'tampered' }],
      })
    ).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.NOTE_IMMUTABLE })
    );

    // signing again is also refused
    expect(() => store.notes.sign(note.id, 'Therapist')).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.NOTE_IMMUTABLE })
    );

    // the stored body is unchanged
    expect(store.notes.get(note.id)!.sections[0].body).toBe('Draft body.');
  });

  it('the storage TRIGGER rejects a raw UPDATE that bypasses the repository', () => {
    const store = freshStore();
    const { note } = seedClientAndDraft(store);
    store.notes.sign(note.id, 'Therapist');

    // Go AROUND the repository and hit the table directly. The trigger must abort.
    expect(() =>
      store.db
        .prepare("UPDATE note SET sections_json = '[]' WHERE id = ?")
        .run(note.id)
    ).toThrowError(/signed note is immutable/i);

    // A raw DELETE of a signed note must also abort.
    expect(() =>
      store.db.prepare('DELETE FROM note WHERE id = ?').run(note.id)
    ).toThrowError(/signed note is immutable/i);

    // The row is still present and signed.
    expect(store.notes.get(note.id)!.status).toBe('signed');
  });

  it('still allows addenda after signing (the sanctioned correction path)', () => {
    const store = freshStore();
    const { note } = seedClientAndDraft(store);
    store.notes.sign(note.id, 'Therapist');

    // (d) addendum is allowed AFTER signing
    const add = store.notes.addAddendum(note.id, 'Therapist', 'Clarification added later.');
    expect(add.note_id).toBe(note.id);
    expect(add.body).toBe('Clarification added later.');

    const addenda = store.notes.addenda(note.id);
    expect(addenda).toHaveLength(1);
    expect(addenda[0].body).toBe('Clarification added later.');
  });

  it('addendum rows are append-only (cannot be updated or deleted)', () => {
    const store = freshStore();
    const { note } = seedClientAndDraft(store);
    store.notes.sign(note.id, 'Therapist');
    const add = store.notes.addAddendum(note.id, 'Therapist', 'Original addendum text.');

    // (e) the addendum's own immutability triggers must fire
    expect(() =>
      store.db
        .prepare("UPDATE note_addendum SET body = 'edited' WHERE id = ?")
        .run(add.id)
    ).toThrowError(/addendum is append-only|immutable/i);

    expect(() =>
      store.db.prepare('DELETE FROM note_addendum WHERE id = ?').run(add.id)
    ).toThrowError(/addendum is append-only|immutable/i);

    // unchanged
    expect(store.notes.addenda(note.id)[0].body).toBe('Original addendum text.');
  });
});
