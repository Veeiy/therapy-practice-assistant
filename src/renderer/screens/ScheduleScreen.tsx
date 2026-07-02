// ScheduleScreen: the functional scheduling + reminders workflow (workflow 3). It
// crosses window.api.scheduling to the SchedulingService:
//
//   create / reschedule / cancel appointments
//   PREVIEW a reminder  ->  shows the EXACT text that WOULD be sent, writes nothing
//   STAGE a reminder    ->  queues it into the OUTBOX with status 'scheduled'
//   view the OUTBOX     ->  every staged reminder, with its preview text
//
// HARD TIER-1 CONSTRAINT, made visible in the UI: there is NO "send" button. The
// strongest action is "Stage in outbox", and a standing notice states that nothing
// is ever sent automatically in this build (sending real email is an operator
// go-live step). The preview is the "visible preview of the exact text" the brief
// requires; the body is the literal email body, with the minimum-necessary default
// (an appointment confirmation, no clinical detail).

import React, { useCallback, useEffect, useState } from 'react';
import type { Appointment, Client } from '../../shared/types/domain.js';
import type { ReminderPreview, StagedReminder } from '../../shared/types/ipc.js';

type Modality = 'in_person' | 'telehealth';

export function ScheduleScreen(): React.ReactElement {
  const [clients, setClients] = useState<Client[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [outbox, setOutbox] = useState<StagedReminder[]>([]);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // new-appointment form
  const [clientId, setClientId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [modality, setModality] = useState<Modality>('telehealth');

  const reload = useCallback(async () => {
    const [cs, as, ob] = await Promise.all([
      window.api.clients.list(),
      window.api.scheduling.list(),
      window.api.scheduling.outbox(),
    ]);
    setClients(cs);
    setAppts(as);
    setOutbox(ob);
    setClientId((prev) => prev || (cs[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

  // Custom buildout: start the modality picker on the practice's provisioned
  // default (scheduling.defaultModality, written by the companion setup plugin).
  // Only the two legal modalities are accepted; anything else leaves telehealth.
  useEffect(() => {
    window.api.config
      .get('scheduling.defaultModality')
      .then((v) => {
        if (v === 'in_person' || v === 'telehealth') setModality(v);
      })
      .catch(() => {
        /* config read is best-effort; the baked default stands */
      });
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const createAppt = () =>
    run(async () => {
      if (!clientId) throw new Error('Choose a client first.');
      if (!startsAt) throw new Error('Pick a start time.');
      // datetime-local yields "YYYY-MM-DDTHH:MM"; send as ISO.
      const iso = new Date(startsAt).toISOString();
      await window.api.scheduling.create({ client_id: clientId, starts_at: iso, modality });
      setStartsAt('');
      await reload();
    });

  const cancel = (id: string) =>
    run(async () => {
      await window.api.scheduling.cancel({ id, by: 'clinician' });
      await reload();
    });

  const doPreview = (id: string) =>
    run(async () => {
      const p = await window.api.scheduling.previewReminder({ appointment_id: id });
      setPreview(p);
    });

  const stage = (id: string) =>
    run(async () => {
      const staged = await window.api.scheduling.stageReminder({ appointment_id: id });
      setPreview(staged.preview);
      await reload();
    });

  return (
    <div className="screen schedule-screen">
      <h2>Scheduling</h2>
      <div className="banner info">
        Reminders are never sent automatically in this build. The strongest action is
        staging a reminder in the outbox; sending real email is a setup step you turn
        on later.
      </div>
      {error && <div className="banner error">{error}</div>}

      <section className="new-appt">
        <h3>New appointment</h3>
        <div className="row">
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
            Starts at
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </label>
          <label>
            Modality
            <select value={modality} onChange={(e) => setModality(e.target.value as Modality)}>
              <option value="telehealth">Telehealth</option>
              <option value="in_person">In person</option>
            </select>
          </label>
          <button className="primary" onClick={createAppt} disabled={busy}>
            Add appointment
          </button>
        </div>
      </section>

      <section>
        <h3>Appointments</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Duration</th>
              <th>Modality</th>
              <th>Status</th>
              <th>Reminder</th>
            </tr>
          </thead>
          <tbody>
            {appts.map((a) => (
              <tr key={a.id}>
                <td>{a.starts_at.slice(0, 16).replace('T', ' ')}</td>
                <td>{a.duration_minutes} min</td>
                <td>{a.modality}</td>
                <td>{a.status}</td>
                <td className="actions-cell">
                  <button onClick={() => doPreview(a.id)} disabled={busy}>
                    Preview
                  </button>
                  <button onClick={() => stage(a.id)} disabled={busy}>
                    Stage in outbox
                  </button>
                  {!a.status.startsWith('cancelled') && (
                    <button onClick={() => cancel(a.id)} disabled={busy}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {appts.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No appointments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {preview && (
        <section className="reminder-preview">
          <h3>Reminder preview (exact text, not sent)</h3>
          <div className="preview-card">
            <div className="muted">To: {preview.to ?? '(no email on file)'}</div>
            <div className="muted">
              Scheduled send: {preview.send_at ? preview.send_at.replace('T', ' ').slice(0, 16) : '-'}
            </div>
            <div className="subject">
              <strong>Subject:</strong> {preview.subject}
            </div>
            <pre className="body">{preview.body}</pre>
            {preview.warnings.length > 0 && (
              <ul className="warnings">
                {preview.warnings.map((w, i) => (
                  <li key={i} className="warning">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section>
        <h3>Outbox (staged, never sent)</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Send at</th>
              <th>Channel</th>
              <th>Status</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {outbox.map((r) => (
              <tr key={r.id}>
                <td>{r.send_at.replace('T', ' ').slice(0, 16)}</td>
                <td>{r.channel}</td>
                <td>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                </td>
                <td>{r.preview.to ?? '(no email)'}</td>
              </tr>
            ))}
            {outbox.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Nothing staged. Use "Stage in outbox" on an appointment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
