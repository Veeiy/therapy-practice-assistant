// seedSynthetic: writes OBVIOUSLY fictional demo data (hard rule 4). Every record
// carries demo=1 so a future "clear demo data" action can find them, and every
// name is a clear placeholder ("Sam Sample", "Pat Placeholder"), never anything
// that could be mistaken for a real person.
//
// This runs on first run into the encrypted DB, and is also used by tests to get a
// realistic client+appointment to attach a note to, plus (Wave 3) a provider
// profile, an intake record, a treatment plan + goal, and an invoice + payment so
// the four workflows all have something real to open on first launch.
//
// IDENTIFIERS ARE FAKE BY CONSTRUCTION. The NPI and tax id on the seeded provider
// profile are obvious placeholders (all-zero / 00-0000000). The app NEVER generates
// a real NPI; the operator enters their own at go-live. Seeding fake ones keeps the
// boundary visible: nothing here is a real registry number.

import type { DataStore } from './dataStore.js';

export interface SeedResult {
  clientIds: string[];
  appointmentIds: string[];
  codeItemCount: number;
  providerProfileId: string;
  intakeIds: string[];
  treatmentPlanIds: string[];
  invoiceIds: string[];
}

export function seedSynthetic(store: DataStore): SeedResult {
  // Seed the user-maintained code picklist (product 4.6): CPT 90791/90834/90837,
  // two POS rows, and two ICD-10 rows so a superbill has a diagnosis to reference.
  // The app never advises codes; this is just the starter list she edits.
  const codeSeeds: { code_type: 'CPT' | 'POS' | 'ICD10'; code: string; label: string }[] = [
    { code_type: 'CPT', code: '90791', label: 'Psychiatric diagnostic evaluation' },
    { code_type: 'CPT', code: '90834', label: 'Psychotherapy, 45 minutes' },
    { code_type: 'CPT', code: '90837', label: 'Psychotherapy, 60 minutes' },
    { code_type: 'POS', code: '11', label: 'Office' },
    { code_type: 'POS', code: '10', label: 'Telehealth in patient home' },
    { code_type: 'ICD10', code: 'F41.1', label: 'Generalized anxiety disorder' },
    { code_type: 'ICD10', code: 'F43.23', label: 'Adjustment disorder with mixed anxiety and depressed mood' },
  ];
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  for (const c of codeSeeds) {
    store.db
      .prepare(
        `INSERT INTO code_item (id, code_type, code, label, active, demo, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), @t, @code, @label, 1, 1, @now, @now)`
      )
      .run({ t: c.code_type, code: c.code, label: c.label, now });
  }

  // Provider profile (single row in v1). NPI/tax id are OBVIOUS placeholders: the
  // operator replaces them with their own real registry numbers at go-live. The app
  // never generates a real NPI.
  const providerProfileId = 'seed-provider';
  store.db
    .prepare(
      `INSERT INTO provider_profile
        (id, legal_name, credential, license_number, license_state, npi, tax_id,
         practice_address_json, signature_display, created_at, updated_at)
       VALUES
        (@id, @legal_name, @credential, @license_number, @license_state, @npi, @tax_id,
         @practice_address_json, @signature_display, @now, @now)`
    )
    .run({
      id: providerProfileId,
      legal_name: 'Demo Provider (Placeholder), LCSW',
      credential: 'LCSW',
      license_number: 'DEMO-0000',
      license_state: 'XX',
      npi: '0000000000', // placeholder; operator enters their real NPI at go-live
      tax_id: '00-0000000', // placeholder; operator enters their real tax id at go-live
      practice_address_json: JSON.stringify({
        street: '000 Placeholder Way',
        city: 'Sampletown',
        state: 'XX',
        postal: '00000',
      }),
      signature_display: 'Demo Provider (Placeholder), LCSW',
      now,
    });

  // Two obviously fictional clients.
  const sam = store.clients.create({
    legal_first_name: 'Sam',
    legal_last_name: 'Sample',
    preferred_name: 'Sam',
    pronouns: 'they/them',
    email: 'sam.sample@example.com',
    preferred_contact_method: 'email',
    presenting_concern: 'Stress management and sleep. Fictional demo record.',
    consent_on_file: true,
    consent_date: today,
    demo: 1,
  });
  const pat = store.clients.create({
    legal_first_name: 'Pat',
    legal_last_name: 'Placeholder',
    preferred_name: 'Pat',
    pronouns: 'she/her',
    email: 'pat.placeholder@example.com',
    preferred_contact_method: 'email',
    presenting_concern: 'Anxiety, work transitions. Fictional demo record.',
    consent_on_file: true,
    consent_date: today,
    demo: 1,
  });

  // One completed appointment each (so the "notes to finish" nudge has something).
  const apptSam = store.appointments.create({
    client_id: sam.id,
    starts_at: now,
    duration_minutes: 50,
    modality: 'telehealth',
    service_type: 'Individual therapy',
    status: 'completed',
    demo: 1,
  });
  const apptPat = store.appointments.create({
    client_id: pat.id,
    starts_at: now,
    duration_minutes: 50,
    modality: 'in_person',
    service_type: 'Individual therapy',
    status: 'completed',
    demo: 1,
  });

  // Intake record for Sam (synthetic clinical free-text only; the AI summary stub
  // reads these). Consent acknowledged with today's date.
  const intakeSam = store.intake.createIntake({
    client_id: sam.id,
    prior_therapy: 'One prior course of CBT in a previous city. Fictional demo data.',
    current_medications: 'None reported. Fictional demo data.',
    substance_use: 'Occasional caffeine. Fictional demo data.',
    family_mh_history: 'Family history of anxiety. Fictional demo data.',
    consent_acknowledged: true,
    consent_acknowledged_date: today,
    demo: 1,
  });

  // Treatment plan + one goal for Sam (the records view reads plan + goals).
  const planSam = store.intake.createPlan(sam.id, 'Initial treatment plan (demo)', 1);
  store.intake.addGoal(
    planSam.id,
    'Reduce reported sleep disturbance to under two nights per week. Fictional demo goal.',
    null,
    1
  );

  // An invoice for Sam from one service line (CPT 90834 + ICD-10 F41.1), with a
  // partial payment recorded so the balance is non-zero on first launch. Money is
  // integer cents end to end. NOTHING is submitted and no money is moved.
  const cpt90834 = store.billing
    .codeItems({ code_type: 'CPT' })
    .find((c) => c.code === '90834');
  const icdF411 = store.billing
    .codeItems({ code_type: 'ICD10' })
    .find((c) => c.code === 'F41.1');
  const invoiceSam = store.billing.createInvoice({
    client_id: sam.id,
    document_type: 'invoice',
    issue_date: today,
    demo: 1,
    lines: [
      {
        appointment_id: apptSam.id,
        date_of_service: today,
        cpt_code_id: cpt90834?.id ?? null,
        icd10_code_id: icdF411?.id ?? null,
        place_of_service_code: '10',
        duration_minutes: 45,
        description: 'Psychotherapy, 45 minutes (demo).',
        fee_cents: 15000, // $150.00
      },
    ],
  });
  store.billing.recordPayment({
    invoice_id: invoiceSam.id,
    amount_cents: 5000, // $50.00 partial; balance becomes $100.00
    method: 'card',
    paid_at: today,
    note: 'Demo partial payment (no money moved).',
    demo: 1,
  });

  return {
    clientIds: [sam.id, pat.id],
    appointmentIds: [apptSam.id, apptPat.id],
    codeItemCount: codeSeeds.length,
    providerProfileId,
    intakeIds: [intakeSam.id],
    treatmentPlanIds: [planSam.id],
    invoiceIds: [invoiceSam.id],
  };
}
