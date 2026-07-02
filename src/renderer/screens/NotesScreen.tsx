// NotesScreen: the functional workflow (workflow 1). It drives the full lifecycle
// through window.api.notes, which crosses the preload bridge to the NoteService:
//
//   pick a client + format  ->  createDraft
//   type shorthand          ->  requestDraft (Mock provider fills the sections)
//   edit any section        ->  saveSections (draft only)
//   sign                    ->  sign (locks the note; F2)
//   after signing           ->  the editor is read-only; an addendum box appears
//
// The screen reflects F2 in the UI: once status is 'signed', the section textareas
// are disabled and the only write action is "add addendum". If a write is attempted
// on a signed note, the bridge throws an Error with code NOTE_IMMUTABLE, which we
// show as a friendly banner instead of a stack trace.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Note, NoteAddendum, NoteSection, Client } from '../../shared/types/domain.js';

type Format = 'SOAP' | 'DAP' | 'BIRP';

// Plain-language expansion of each note format (C2). Kept inline and offline; no
// network or model call is involved in showing this legend.
const FORMAT_LEGEND: Record<Format, string> = {
  SOAP: 'SOAP: Subjective, Objective, Assessment, Plan.',
  DAP: 'DAP: Data, Assessment, Plan.',
  BIRP: 'BIRP: Behavior, Intervention, Response, Plan.',
};

export function NotesScreen(): React.ReactElement {
  const [clients, setClients] = useState<Client[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [active, setActive] = useState<{ note: Note; addenda: NoteAddendum[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A5/A6: status text announced to screen readers via live regions. The draft
  // message is polite (it can wait); the sign message is assertive (it confirms an
  // irreversible action). Both strings stay local: no egress is involved.
  const [draftStatus, setDraftStatus] = useState('');
  const [signStatus, setSignStatus] = useState('');
  // A5: after a draft is generated, move keyboard focus to the first section field.
  const firstSectionRef = useRef<HTMLTextAreaElement | null>(null);
  const focusFirstSection = useRef(false);

  // new-draft form state
  const [clientId, setClientId] = useState('');
  const [format, setFormat] = useState<Format>('SOAP');
  const [shorthand, setShorthand] = useState('');

  const reload = useCallback(async () => {
    const [cs, ns] = await Promise.all([window.api.clients.list(), window.api.notes.list()]);
    setClients(cs);
    setNotes(ns);
    if (cs.length && !clientId) setClientId(cs[0].id);
  }, [clientId]);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

  // Custom buildout: start the format picker on the practice's provisioned
  // default (notes.defaultFormat, written by the companion setup plugin). Only a
  // known format is accepted; anything else leaves the picker on SOAP.
  useEffect(() => {
    window.api.config
      .get('notes.defaultFormat')
      .then((v) => {
        if (v === 'SOAP' || v === 'DAP' || v === 'BIRP') setFormat(v);
      })
      .catch(() => {
        /* config read is best-effort; the baked default stands */
      });
  }, []);

  const open = async (id: string) => {
    setError(null);
    const v = await window.api.notes.get(id);
    setActive(v);
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // friendly message; the bridge attaches .code (e.g. NOTE_IMMUTABLE)
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const createDraft = () =>
    guard(async () => {
      if (!clientId) throw new Error('Choose a client first.');
      const note = await window.api.notes.createDraft({ client_id: clientId, format });
      await reload();
      await open(note.id);
    });

  const requestDraft = () =>
    guard(async () => {
      if (!active) return;
      setDraftStatus('Drafting from your summary. This runs offline on this computer.');
      const updated = await window.api.notes.requestDraft({
        note_id: active.note.id,
        shorthand,
      });
      setActive({ note: updated, addenda: active.addenda });
      // Announce completion politely and move focus to the first section to edit.
      setDraftStatus('Draft complete. Sections are ready to edit.');
      focusFirstSection.current = true;
    });

  const editSection = (key: string, body: string) => {
    if (!active) return;
    const sections = active.note.sections.map((s) => (s.key === key ? { ...s, body } : s));
    setActive({ note: { ...active.note, sections }, addenda: active.addenda });
  };

  const save = () =>
    guard(async () => {
      if (!active) return;
      const updated = await window.api.notes.saveSections({
        note_id: active.note.id,
        sections: active.note.sections as NoteSection[],
      });
      setActive({ note: updated, addenda: active.addenda });
    });

  const sign = () =>
    guard(async () => {
      if (!active) return;
      const updated = await window.api.notes.sign({
        note_id: active.note.id,
        signed_by: 'Therapist',
      });
      setActive({ note: updated, addenda: active.addenda });
      // A6: confirm the irreversible action assertively for screen-reader users.
      setSignStatus('Note signed. Locked; addenda only.');
      await reload();
    });

  // A5: once a generated draft has populated the sections, move keyboard focus to
  // the first section textarea so the therapist lands where editing begins.
  useEffect(() => {
    if (focusFirstSection.current && firstSectionRef.current) {
      firstSectionRef.current.focus();
      focusFirstSection.current = false;
    }
  });

  const signed = active?.note.status === 'signed';

  return (
    <div className="screen notes-screen">
      <div className="col list-col">
        <h2>Session Notes</h2>

        <div className="new-draft">
          <label>
            Client
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.preferred_name ?? c.legal_first_name} {c.legal_last_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              <option value="SOAP">SOAP</option>
              <option value="DAP">DAP</option>
              <option value="BIRP">BIRP</option>
            </select>
          </label>
          <p className="format-legend">{FORMAT_LEGEND[format]}</p>
          <button className="primary" onClick={createDraft} disabled={busy}>
            New draft
          </button>
        </div>

        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <button className={active?.note.id === n.id ? 'active' : ''} onClick={() => open(n.id)}>
                <span className={`pill ${n.status}`}>{n.status}</span>
                {n.format} note
                <span className="muted">{n.created_at.slice(0, 10)}</span>
              </button>
            </li>
          ))}
          {notes.length === 0 && <li className="muted">No notes yet. Create a draft above.</li>}
        </ul>
      </div>

      <div className="col editor-col">
        {error && <div className="banner error">{error}</div>}

        {!active && <div className="empty">Select or create a note to begin.</div>}

        {active && (
          <>
            <div className="editor-head">
              <h3>
                {active.note.format} note
                <span className={`pill ${active.note.status}`}>{active.note.status}</span>
              </h3>
              {signed && (
                <p className="signed-note">
                  This note is signed and locked (signed on{' '}
                  {active.note.signed_at?.slice(0, 10)} by {active.note.signed_by}). You cannot edit
                  the sections above. To record a correction or add information, add an addendum
                  below.
                </p>
              )}
            </div>

            {/* A5/A6: visually hidden live regions. Screen readers announce draft
                completion (polite) and the signed/locked result (assertive). */}
            <p className="sr-only" role="status" aria-live="polite">
              {draftStatus}
            </p>
            <p className="sr-only" role="alert" aria-live="assertive">
              {signStatus}
            </p>

            {!signed && (
              <div className="shorthand">
                <p className="offline-note">
                  This assistant uses demo data only and works offline. Your real client information
                  stays on this computer.
                </p>
                <label>
                  Session summary
                  <span className="field-help">
                    Summarize the key clinical points from the session. The assistant will expand
                    this into complete sections.
                  </span>
                  <textarea
                    rows={3}
                    value={shorthand}
                    onChange={(e) => setShorthand(e.target.value)}
                    placeholder="e.g. discussed sleep and work stress; practiced breathing; agreed on a sleep log"
                  />
                </label>
                <button onClick={requestDraft} disabled={busy || !shorthand.trim()} aria-busy={busy}>
                  Draft with assistant
                </button>
              </div>
            )}

            <div className="sections" aria-live="polite">
              {active.note.sections.map((s, idx) => (
                <label key={s.key} className="section">
                  <span className="section-label">{s.label}</span>
                  <textarea
                    ref={idx === 0 ? firstSectionRef : undefined}
                    rows={4}
                    value={s.body}
                    disabled={signed}
                    onChange={(e) => editSection(s.key, e.target.value)}
                  />
                </label>
              ))}
            </div>

            {!signed && (
              <div className="actions">
                <button onClick={save} disabled={busy} aria-busy={busy}>
                  Save draft
                </button>
                <button
                  className="primary"
                  onClick={sign}
                  disabled={busy}
                  aria-busy={busy}
                  aria-label="Sign and lock note (this action cannot be undone)"
                >
                  Sign and lock
                </button>
              </div>
            )}

            {signed && <Addenda noteId={active.note.id} initial={active.addenda} />}
          </>
        )}
      </div>
    </div>
  );
}

// Addenda: the append-only correction path, available only after signing.
function Addenda(props: { noteId: string; initial: NoteAddendum[] }): React.ReactElement {
  const [items, setItems] = useState<NoteAddendum[]>(props.initial);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const a = await window.api.notes.addAddendum({
        note_id: props.noteId,
        author: 'Therapist',
        body,
      });
      setItems((prev) => [...prev, a]);
      setBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add addendum.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="addenda">
      <h4>Addenda</h4>
      <p className="field-help">
        An addendum is a dated note you add after signing. It records a correction or new
        information without changing the original, locked note.
      </p>
      {items.map((a) => (
        <div key={a.id} className="addendum">
          <div className="muted">
            {a.author} on {a.created_at.slice(0, 16).replace('T', ' ')}
          </div>
          <div>{a.body}</div>
        </div>
      ))}
      {error && <div className="banner error">{error}</div>}
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Record a correction or addition. The original note stays unchanged."
      />
      <button onClick={add} disabled={busy || !body.trim()}>
        Add addendum
      </button>
    </div>
  );
}
