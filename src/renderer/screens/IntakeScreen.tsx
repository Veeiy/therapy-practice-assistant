// IntakeScreen: the functional client-intake + records workflow (workflow 2). It
// crosses window.api.intake to the IntakeService:
//
//   pick a client                ->  load the records view (intake + plans + goals)
//   fill the CONFIG-DRIVEN form  ->  create (SchemaForm renders whatever config defines)
//   summarize an intake          ->  AI stub (offline, dash-free, minimum-necessary)
//   add a treatment plan + goal  ->  createPlan / addGoal
//
// The form is NOT hard-coded here: it is fetched from intake.fields via
// window.api.intake.fields() and rendered by the reusable SchemaForm. Adding a field
// in config changes this screen with no code change. Every record is the obviously
// fictional demo data (hard rule 4); the data mode badge in the rail makes that
// explicit.

import React, { useCallback, useEffect, useState } from 'react';
import type { Client } from '../../shared/types/domain.js';
import type { FormFieldDef } from '../../shared/types/module.js';
import type { ClientRecords } from '../../shared/types/ipc.js';
import { SchemaForm } from '../components/SchemaForm.js';

export function IntakeScreen(): React.ReactElement {
  const [clients, setClients] = useState<Client[]>([]);
  const [fields, setFields] = useState<FormFieldDef[]>([]);
  const [clientId, setClientId] = useState('');
  const [records, setRecords] = useState<ClientRecords | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [planTitle, setPlanTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRecords = useCallback(async (id: string) => {
    if (!id) {
      setRecords(null);
      return;
    }
    const r = await window.api.intake.recordsForClient(id);
    setRecords(r);
  }, []);

  useEffect(() => {
    (async () => {
      const [cs, spec] = await Promise.all([
        window.api.clients.list(),
        window.api.intake.fields(),
      ]);
      setClients(cs);
      setFields(spec.fields);
      if (cs.length) {
        setClientId(cs[0].id);
        await loadRecords(cs[0].id);
      }
    })().catch((e) => setError(String(e)));
  }, [loadRecords]);

  const onPickClient = async (id: string) => {
    setClientId(id);
    setError(null);
    setSummaries({});
    await loadRecords(id).catch((e) => setError(String(e)));
  };

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

  const submitIntake = (values: Record<string, unknown>) =>
    run(async () => {
      if (!clientId) throw new Error('Choose a client first.');
      await window.api.intake.create({
        client_id: clientId,
        values,
        consent_acknowledged: Boolean(values.consent_acknowledged),
      });
      await loadRecords(clientId);
    });

  const summarize = (intakeId: string) =>
    run(async () => {
      const { summary } = await window.api.intake.summarize({ intake_id: intakeId });
      setSummaries((prev) => ({ ...prev, [intakeId]: summary }));
    });

  const addPlan = () =>
    run(async () => {
      if (!clientId) throw new Error('Choose a client first.');
      if (!planTitle.trim()) throw new Error('Give the plan a title.');
      await window.api.intake.createPlan({ client_id: clientId, title: planTitle.trim() });
      setPlanTitle('');
      await loadRecords(clientId);
    });

  return (
    <div className="screen intake-screen">
      <div className="col list-col">
        <h2>Intake</h2>
        <label>
          Client
          <select value={clientId} onChange={(e) => onPickClient(e.target.value)}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.preferred_name ?? c.legal_first_name} {c.legal_last_name}
              </option>
            ))}
          </select>
        </label>

        <h3>New intake</h3>
        <p className="muted">
          This form is defined in config. Editing the field list changes it with no
          rebuild. Demo data only.
        </p>
        {fields.length > 0 && (
          <SchemaForm
            fields={fields}
            busy={busy}
            submitLabel="Save intake"
            onSubmit={submitIntake}
          />
        )}
      </div>

      <div className="col records-col">
        {error && <div className="banner error">{error}</div>}

        <h3>Records</h3>
        {!records && <div className="empty">Select a client to view records.</div>}

        {records && (
          <>
            <section>
              <h4>Intake records</h4>
              {records.intake.length === 0 && <p className="muted">No intake on file yet.</p>}
              {records.intake.map((rec) => (
                <div key={rec.id} className="record-card">
                  <div className="muted">Recorded {rec.created_at.slice(0, 10)}</div>
                  <dl>
                    {rec.prior_therapy && (
                      <>
                        <dt>Prior therapy</dt>
                        <dd>{rec.prior_therapy}</dd>
                      </>
                    )}
                    {rec.current_medications && (
                      <>
                        <dt>Medications</dt>
                        <dd>{rec.current_medications}</dd>
                      </>
                    )}
                    {rec.family_mh_history && (
                      <>
                        <dt>Family history</dt>
                        <dd>{rec.family_mh_history}</dd>
                      </>
                    )}
                  </dl>
                  <div className="consent muted">
                    Consent acknowledged: {rec.consent_acknowledged ? 'yes' : 'no'}
                    {rec.consent_acknowledged_date ? ` (${rec.consent_acknowledged_date})` : ''}
                  </div>
                  <button onClick={() => summarize(rec.id)} disabled={busy} aria-busy={busy}>
                    Summarize with assistant
                  </button>
                  {summaries[rec.id] && <p className="summary">{summaries[rec.id]}</p>}
                </div>
              ))}
            </section>

            <section>
              <h4>Treatment plans</h4>
              {records.plans.length === 0 && <p className="muted">No treatment plans yet.</p>}
              {records.plans.map(({ plan, goals }) => (
                <div key={plan.id} className="record-card">
                  <strong>{plan.title}</strong>
                  <span className={`pill ${plan.status}`}>{plan.status}</span>
                  <ul className="goal-list">
                    {goals.map((g) => (
                      <li key={g.id}>
                        {g.goal_text}
                        <span className="muted"> ({g.status})</span>
                      </li>
                    ))}
                    {goals.length === 0 && <li className="muted">No goals yet.</li>}
                  </ul>
                </div>
              ))}
              <div className="new-plan">
                <input
                  type="text"
                  value={planTitle}
                  placeholder="New treatment plan title"
                  onChange={(e) => setPlanTitle(e.target.value)}
                />
                <button onClick={addPlan} disabled={busy || !planTitle.trim()} aria-busy={busy}>
                  Add plan
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
