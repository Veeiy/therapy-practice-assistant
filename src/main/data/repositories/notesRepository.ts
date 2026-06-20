// notesRepository: the ONLY code that writes note/note_addendum SQL.
//
// F2 is enforced in TWO layers, both keyed on the SAME canonical predicate
// (status = 'signed'):
//   1. the SQL trigger in 0001_init.sql (storage-level, cannot be bypassed), and
//   2. this repository, which refuses update/delete on a signed row in app code
//      and raises NOTE_IMMUTABLE with a plain message before SQL is even reached.
// The two layers agree because they both check status = 'signed'.

import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import type { Note, NoteAddendum, NoteSection, NoteFormat } from '@shared/types/domain.js';
import { ERROR_CODES } from '@shared/constants.js';
import {
  type Clock,
  type IdGen,
  parseJson,
  toJson,
  boolToInt,
  intToBool,
} from './support.js';

interface NoteRow {
  id: string;
  client_id: string;
  appointment_id: string | null;
  treatment_plan_goal_id: string | null;
  diagnosis_code_id: string | null;
  format: NoteFormat;
  status: 'draft' | 'signed';
  date_of_service: string | null;
  session_start: string | null;
  duration_minutes: number | null;
  modality: 'in_person' | 'telehealth' | null;
  place_of_service_code: string | null;
  sections_json: string;
  shorthand_input: string | null;
  ai_assisted: number;
  signed_by: string | null;
  signed_at: string | null;
  demo: number;
  created_at: string;
  updated_at: string;
}

function rowToNote(r: NoteRow): Note {
  return {
    id: r.id,
    client_id: r.client_id,
    appointment_id: r.appointment_id,
    treatment_plan_goal_id: r.treatment_plan_goal_id,
    diagnosis_code_id: r.diagnosis_code_id,
    format: r.format,
    status: r.status,
    date_of_service: r.date_of_service,
    session_start: r.session_start,
    duration_minutes: r.duration_minutes,
    modality: r.modality,
    place_of_service_code: r.place_of_service_code,
    sections: parseJson<NoteSection[]>(r.sections_json, []),
    shorthand_input: r.shorthand_input,
    ai_assisted: intToBool(r.ai_assisted),
    signed_by: r.signed_by,
    signed_at: r.signed_at,
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface CreateNoteInput {
  client_id: string;
  appointment_id?: string | null;
  format: NoteFormat;
  sections: NoteSection[];
  date_of_service?: string | null;
  duration_minutes?: number | null;
  modality?: 'in_person' | 'telehealth' | null;
  demo?: 0 | 1;
}

export class NotesRepository {
  constructor(
    private readonly db: DB,
    private readonly clock: Clock,
    private readonly ids: IdGen
  ) {}

  create(input: CreateNoteInput): Note {
    const now = this.clock.nowIso();
    const id = this.ids.next();
    this.db
      .prepare(
        `INSERT INTO note
          (id, client_id, appointment_id, format, status, date_of_service,
           duration_minutes, modality, sections_json, shorthand_input, ai_assisted,
           demo, created_at, updated_at)
         VALUES
          (@id, @client_id, @appointment_id, @format, 'draft', @date_of_service,
           @duration_minutes, @modality, @sections_json, NULL, 0,
           @demo, @now, @now)`
      )
      .run({
        id,
        client_id: input.client_id,
        appointment_id: input.appointment_id ?? null,
        format: input.format,
        date_of_service: input.date_of_service ?? null,
        duration_minutes: input.duration_minutes ?? null,
        modality: input.modality ?? null,
        sections_json: toJson(input.sections) ?? '[]',
        demo: input.demo ?? 0,
        now,
      });
    return this.get(id)!;
  }

  get(id: string): Note | null {
    const r = this.db.prepare('SELECT * FROM note WHERE id = ?').get(id) as NoteRow | undefined;
    return r ? rowToNote(r) : null;
  }

  list(filter?: { client_id?: string; status?: string }): Note[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter?.client_id) {
      where.push('client_id = @client_id');
      params.client_id = filter.client_id;
    }
    if (filter?.status) {
      where.push('status = @status');
      params.status = filter.status;
    }
    const sql =
      'SELECT * FROM note' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(params) as NoteRow[];
    return rows.map(rowToNote);
  }

  /** Update a DRAFT note's editable fields. Refuses if the note is signed (F2). */
  updateDraft(
    id: string,
    patch: {
      sections?: NoteSection[];
      shorthand_input?: string | null;
      ai_assisted?: boolean;
      diagnosis_code_id?: string | null;
      treatment_plan_goal_id?: string | null;
      place_of_service_code?: string | null;
    }
  ): Note {
    this.assertMutable(id);
    const current = this.get(id);
    if (!current) throw new Error('Note not found.');
    const now = this.clock.nowIso();
    this.db
      .prepare(
        `UPDATE note SET
           sections_json = @sections_json,
           shorthand_input = @shorthand_input,
           ai_assisted = @ai_assisted,
           diagnosis_code_id = @diagnosis_code_id,
           treatment_plan_goal_id = @treatment_plan_goal_id,
           place_of_service_code = @place_of_service_code,
           updated_at = @now
         WHERE id = @id`
      )
      .run({
        id,
        sections_json: toJson(patch.sections ?? current.sections) ?? '[]',
        shorthand_input:
          patch.shorthand_input !== undefined ? patch.shorthand_input : current.shorthand_input,
        ai_assisted: boolToInt(patch.ai_assisted ?? current.ai_assisted),
        diagnosis_code_id:
          patch.diagnosis_code_id !== undefined
            ? patch.diagnosis_code_id
            : current.diagnosis_code_id,
        treatment_plan_goal_id:
          patch.treatment_plan_goal_id !== undefined
            ? patch.treatment_plan_goal_id
            : current.treatment_plan_goal_id,
        place_of_service_code:
          patch.place_of_service_code !== undefined
            ? patch.place_of_service_code
            : current.place_of_service_code,
        now,
      });
    return this.get(id)!;
  }

  /**
   * The sign transition: draft -> signed, writing signed_by + signed_at. This is
   * the ONLY place status becomes 'signed'. After this returns, both the trigger
   * and assertMutable() will reject any further UPDATE/DELETE (F2).
   */
  sign(id: string, signedBy: string): Note {
    this.assertMutable(id);
    const now = this.clock.nowIso();
    // The note is still 'draft' here, so this UPDATE is allowed by the trigger.
    this.db
      .prepare(
        `UPDATE note SET status = 'signed', signed_by = @signed_by, signed_at = @now,
                          updated_at = @now
         WHERE id = @id AND status = 'draft'`
      )
      .run({ id, signed_by: signedBy, now });
    return this.get(id)!;
  }

  /** Append an addendum. Allowed even (and especially) after signing. */
  addAddendum(noteId: string, author: string, body: string): NoteAddendum {
    const note = this.get(noteId);
    if (!note) throw new Error('Note not found.');
    const now = this.clock.nowIso();
    const id = this.ids.next();
    this.db
      .prepare(
        `INSERT INTO note_addendum (id, note_id, author, body, created_at)
         VALUES (@id, @note_id, @author, @body, @now)`
      )
      .run({ id, note_id: noteId, author, body, now });
    return { id, note_id: noteId, author, body, created_at: now };
  }

  addenda(noteId: string): NoteAddendum[] {
    return this.db
      .prepare('SELECT * FROM note_addendum WHERE note_id = ? ORDER BY created_at ASC')
      .all(noteId) as NoteAddendum[];
  }

  /** Application-layer half of F2: throw before SQL if the note is signed. */
  private assertMutable(id: string): void {
    const row = this.db.prepare('SELECT status FROM note WHERE id = ?').get(id) as
      | { status: string }
      | undefined;
    if (row && row.status === 'signed') {
      const err = new Error(
        'This note is signed and cannot be edited. Add an addendum to record a correction.'
      );
      (err as NodeJS.ErrnoException).code = ERROR_CODES.NOTE_IMMUTABLE;
      throw err;
    }
  }
}
