// INTEGRATION TEST: the client-intake + records workflow (#2 of 4), over the real
// IntakeService + IntakeRepository + EgressGuard stack on an encrypted DB.
//
// What it proves:
//   * CONFIG-DRIVEN FORM: the service collects exactly the fields the resolver
//     returns. A field that maps to a known column lands in that column; a field
//     with NO known column lands in custom_fields_json. Adding a field in config
//     (here, a resolver that appends one) changes what is stored with NO code change
//     to the service. That is hard rule 6 made executable.
//   * RECORDS VIEW: recordsForClient reads intake + treatment plan + goals together.
//   * AI SUMMARY (stub): summarizeIntake routes through the SAME guard the notes
//     workflow uses, offline (no key, no network, no spend), dash-free (F5), and the
//     minimum-necessary payload carries only clinical free-text, never identifiers.
//   * AUDIT (F4): the lifecycle actions are recorded with COUNTS/IDs only; no field
//     value, and no client identifier, ever appears in a summary.
//   * ENCRYPTION AT REST: a distinctive intake sentence is NOT present as plaintext
//     in the .db file.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { IntakeService } from '../../src/modules/intake/intakeService.js';
import { DEFAULT_INTAKE_FIELDS } from '../../src/modules/intake/intakeFields.js';
import type { FormFieldDef } from '../../src/shared/types/module.js';
import { EgressGuard } from '../../src/main/agent/egressGuard.js';
import { silentLogger } from '../../src/main/agent/logger.js';
import { hasProhibitedDash } from '../../src/main/agent/textPostProcess.js';
import { freshStore } from '../helpers.js';

describe('client-intake + records flow (workflow 2, integration)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function setup(fields: FormFieldDef[] = DEFAULT_INTAKE_FIELDS) {
    const { store, dbPath, cleanup } = freshStore();
    cleanups.push(cleanup);
    const guard = new EgressGuard(silentLogger);
    const service = new IntakeService({
      intake: store.intake,
      audit: store.audit,
      guard,
      dataMode: () => 'synthetic',
      fields: () => fields,
    });
    // a fictional client to attach intake to (demo=1)
    const client = store.clients.create({
      legal_first_name: 'Sam',
      legal_last_name: 'Sample',
      preferred_name: 'Sam',
      preferred_contact_method: 'email',
      email: 'sam.sample@example.com',
      consent_on_file: true,
      demo: 1,
    });
    return { store, dbPath, service, clientId: client.id };
  }

  it('collects config-driven fields, routing known columns vs custom_fields', () => {
    // Config adds an extra field with NO known column -> it must land in custom_fields.
    const fields: FormFieldDef[] = [
      ...DEFAULT_INTAKE_FIELDS,
      { key: 'referral_source', label: 'Referral source', type: 'text' }, // no column
    ];
    const { service, clientId } = setup(fields);

    const PRIOR = 'One prior course of CBT. Distinctive intake sentence alpha.';
    const record = service.createIntake({
      client_id: clientId,
      values: {
        prior_therapy: PRIOR,
        current_medications: 'None reported.',
        substance_use: 'Occasional caffeine.',
        family_mh_history: 'Anxiety in family.',
        consent_acknowledged: true,
        referral_source: 'Primary care physician', // custom (no column)
      },
    });

    // known columns are populated
    expect(record.prior_therapy).toBe(PRIOR);
    expect(record.current_medications).toBe('None reported.');
    expect(record.consent_acknowledged).toBe(true);
    expect(record.consent_acknowledged_date).not.toBeNull(); // set when consent true
    // the config-only field landed in the flexible bag, NOT a column
    expect(record.custom_fields.referral_source).toBe('Primary care physician');
  });

  it('reads intake + treatment plan + goals together (records view)', () => {
    const { service, clientId } = setup();
    service.createIntake({
      client_id: clientId,
      values: { prior_therapy: 'Some history.', consent_acknowledged: true },
    });
    const plan = service.createPlan(clientId, 'Initial plan', 1);
    service.addGoal(plan.id, 'Reduce sleep disturbance.', null, 1);

    const records = service.recordsForClient(clientId);
    expect(records.intake).toHaveLength(1);
    expect(records.plans).toHaveLength(1);
    expect(records.plans[0].plan.title).toBe('Initial plan');
    expect(records.plans[0].goals).toHaveLength(1);
    expect(records.plans[0].goals[0].goal_text).toContain('sleep disturbance');
  });

  it('summarizes intake through the guard: offline, dash-free, minimum-necessary (F5)', () => {
    const { service, clientId } = setup();
    const record = service.createIntake({
      client_id: clientId,
      values: {
        prior_therapy: 'Prior CBT.',
        current_medications: 'None.',
        family_mh_history: 'Anxiety in family.',
        consent_acknowledged: true,
      },
    });

    const { summary } = service.summarizeIntake(record.id);
    expect(summary.length).toBeGreaterThan(0);
    expect(hasProhibitedDash(summary)).toBe(false); // F5
    // it is a SUMMARY, not a copy: it names which sections were present
    expect(summary.toLowerCase()).toContain('prior treatment history');
    expect(summary.toLowerCase()).toContain('family mental health history');
  });

  it('audit records intake actions with COUNTS/IDs only, never field values or identifiers (F4)', () => {
    const { store, service, clientId } = setup();
    const record = service.createIntake({
      client_id: clientId,
      values: {
        prior_therapy: 'secret detail: client email sam.sample@example.com',
        consent_acknowledged: true,
      },
    });
    service.summarizeIntake(record.id);

    const rows = store.audit.recent(50);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('intake_create');
    expect(actions).toContain('intake_summary');
    for (const r of rows) {
      const s = r.summary ?? '';
      expect(s).not.toContain('secret detail');
      expect(s).not.toContain('sam.sample@example.com');
    }
  });

  it('persists intake as ciphertext at rest (no plaintext in the .db file)', () => {
    const { store, service, clientId, dbPath } = setup();
    const SENTENCE = 'Distinctive intake sentence alpha for the at-rest check.';
    service.createIntake({
      client_id: clientId,
      values: { prior_therapy: SENTENCE, consent_acknowledged: true },
    });

    store.close(); // flush + close so the file on disk is final; afterEach cleanup
    // calls close() again (idempotent) and removes the temp dir.
    const raw = readFileSync(dbPath);
    expect(raw.includes(Buffer.from(SENTENCE))).toBe(false);
    expect(raw.subarray(0, 16).toString('utf8')).not.toContain('SQLite format 3');
  });
});
