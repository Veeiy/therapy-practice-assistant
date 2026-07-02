// noteService: the session-notes lifecycle, end to end. This is the service the
// IPC layer calls and the integration test exercises. It ties together the
// repository (F2 immutability), the provider abstraction (Mock by default), the
// EgressGuard (inside the provider), and the em-dash post-processor (F5).
//
// Lifecycle (product 3.1 / 3.6):
//   createDraft        -> a draft note with empty sections for the chosen format
//   requestDraft       -> provider.draftNote() fills sections from shorthand
//   saveSections       -> therapist edits (draft only)
//   sign               -> status draft -> signed; the note becomes immutable (F2)
//   addAddendum        -> append-only child, allowed after signing
// Attempting saveSections/sign again after sign throws NOTE_IMMUTABLE.

import type { Note, NoteAddendum, NoteFormat, NoteSection } from '@shared/types/domain.js';
import type { DataMode } from '@shared/constants.js';
import type { ModelProvider, DraftNoteInput } from '@shared/types/agent.js';
import type { NotesRepository } from '@main/data/repositories/notesRepository.js';
import type { AuditRepository } from '@main/data/repositories/auditRepository.js';
import { NOTE_FORMATS, emptySectionsFor, type FormatSection } from './noteFormats.js';
import { stripDashes } from '@main/agent/textPostProcess.js';

export interface NoteServiceDeps {
  notes: NotesRepository;
  audit: AuditRepository;
  /** the selected provider (Mock in this build). */
  provider: ModelProvider;
  /** current app data mode; attached to the draft request. Synthetic in this run. */
  dataMode: DataMode;
  /** resolve a format's section config; defaults to the built-in NOTE_FORMATS but
   * can be backed by the config store so formats are editable without a rebuild. */
  formatSections?: (format: NoteFormat) => FormatSection[];
  /** the format a new draft starts on when the caller does not choose one
   * (custom buildout: backed by the provisioned `notes.defaultFormat` config).
   * Optional; absent means the baked-in SOAP default. */
  defaultFormat?: () => NoteFormat;
}

export interface CreateDraftArgs {
  client_id: string;
  appointment_id?: string | null;
  /** omitted means "use the practice's provisioned default format". */
  format?: NoteFormat;
  date_of_service?: string | null;
  duration_minutes?: number | null;
  modality?: 'in_person' | 'telehealth' | null;
  demo?: 0 | 1;
}

export interface RequestDraftArgs {
  note_id: string;
  shorthand: string;
  cues?: DraftNoteInput['cues'];
}

export class NoteService {
  constructor(private readonly deps: NoteServiceDeps) {}

  private sectionsFor(format: NoteFormat): FormatSection[] {
    return (this.deps.formatSections ?? ((f) => NOTE_FORMATS[f]))(format);
  }

  /** Create a fresh DRAFT note with empty sections for the chosen format, or the
   * practice's provisioned default format when none is chosen. */
  createDraft(args: CreateDraftArgs): Note {
    const format = args.format ?? this.deps.defaultFormat?.() ?? 'SOAP';
    const note = this.deps.notes.create({
      client_id: args.client_id,
      appointment_id: args.appointment_id ?? null,
      format,
      sections: emptySectionsFor(format),
      date_of_service: args.date_of_service ?? null,
      duration_minutes: args.duration_minutes ?? null,
      modality: args.modality ?? null,
      demo: args.demo ?? 0,
    });
    this.deps.audit.record('note_create_draft', 'note', note.id, `format=${format}`);
    return note;
  }

  /**
   * Request an AI draft. Reads the note, builds the provider input from the
   * shorthand + format config, calls the provider (which guards + minimizes +,
   * for the real provider, post-processes), and stores the returned sections plus
   * the shorthand and ai_assisted=true. Refuses on a signed note (F2).
   */
  async requestDraft(args: RequestDraftArgs): Promise<Note> {
    const note = this.deps.notes.get(args.note_id);
    if (!note) throw new Error('Note not found.');
    if (note.status === 'signed') {
      // assertMutable in updateDraft would also catch this; we fail fast here too.
      const err = new Error('This note is signed and cannot be re-drafted.');
      (err as NodeJS.ErrnoException).code = 'NOTE_IMMUTABLE';
      throw err;
    }

    const sections = this.sectionsFor(note.format).map((s) => ({ key: s.key, label: s.label }));
    const input: DraftNoteInput = {
      format: note.format,
      sections,
      shorthand: args.shorthand,
      cues: args.cues,
      mode: this.deps.dataMode,
    };

    const result = await this.deps.provider.draftNote(input);

    // F5 belt-and-braces: even though each provider already strips dashes, run the
    // post-process here too so NOTHING reaches the DB with a prohibited dash,
    // regardless of which provider produced it.
    const cleanSections: NoteSection[] = result.sections.map((s) => ({
      key: s.key,
      label: s.label,
      body: stripDashes(s.body),
    }));

    const updated = this.deps.notes.updateDraft(note.id, {
      sections: cleanSections,
      shorthand_input: args.shorthand,
      ai_assisted: result.ai_assisted,
    });
    this.deps.audit.record('note_ai_draft', 'note', note.id, `provider=${result.provider}`);
    return updated;
  }

  /** Therapist edits the draft sections. Refuses on a signed note (F2). */
  saveSections(noteId: string, sections: NoteSection[]): Note {
    // strip dashes from edited content too, so the signed record never carries one
    const clean = sections.map((s) => ({ ...s, body: stripDashes(s.body) }));
    const updated = this.deps.notes.updateDraft(noteId, { sections: clean });
    this.deps.audit.record('note_edit', 'note', noteId, `sections=${clean.length}`);
    return updated;
  }

  /** Sign and lock. After this the note is immutable (F2). */
  sign(noteId: string, signedBy: string): Note {
    const signed = this.deps.notes.sign(noteId, signedBy);
    this.deps.audit.record('note_sign', 'note', noteId, 'status=signed');
    return signed;
  }

  /** Append-only correction; allowed after signing. */
  addAddendum(noteId: string, author: string, body: string): NoteAddendum {
    const add = this.deps.notes.addAddendum(noteId, author, stripDashes(body));
    this.deps.audit.record('note_addendum', 'note', noteId, `addendum=${add.id}`);
    return add;
  }

  get(noteId: string): { note: Note; addenda: NoteAddendum[] } | null {
    const note = this.deps.notes.get(noteId);
    if (!note) return null;
    return { note, addenda: this.deps.notes.addenda(noteId) };
  }

  list(filter?: { client_id?: string; status?: string }): Note[] {
    return this.deps.notes.list(filter);
  }
}
