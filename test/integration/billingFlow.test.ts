// INTEGRATION TEST: the billing + invoicing workflow (#4 of 4), over the real
// BillingService + BillingRepository + EgressGuard stack on an encrypted DB.
//
// What it proves:
//   * INVOICE-CENTRIC + INTEGER CENTS: generateInvoice builds invoice -> service_line
//     and totals fees in integer cents (no float drift). getInvoice returns the
//     invoice + lines + payments + a balance computed in integer cents.
//   * CODES ARE AN FK PICKLIST, NEVER FREE TEXT: a service line whose cpt/icd id is
//     not a real code_item of the right type is REJECTED. A correct FK id is accepted.
//   * SUPERBILL VARIANT: generateSuperbill produces the self-submit document with the
//     provider header (NPI from provider_profile) and carries the billing-boundary
//     DISCLAIMER (productivity tool, does not submit claims, does not move money).
//   * RECORD PAYMENT MOVES NO MONEY: recordPayment writes a bookkeeping ROW and the
//     balance drops by exactly that integer-cent amount; the invoice status reflects
//     partial vs paid. There is NO chargeCard / submitClaim method on the service.
//   * DASH-FREE (F5): the AI statement summary carries no prohibited dash.
//   * AUDIT (F4): generate + payment record actions are metadata-only.

import { describe, it, expect, afterEach } from 'vitest';
import { BillingService } from '../../src/modules/billing/billingService.js';
import { EgressGuard } from '../../src/main/agent/egressGuard.js';
import { silentLogger } from '../../src/main/agent/logger.js';
import { hasProhibitedDash } from '../../src/main/agent/textPostProcess.js';
import { DISCLAIMERS } from '../../src/shared/disclaimers.js';
import { seedSynthetic } from '../../src/main/data/seedSynthetic.js';
import { freshStore } from '../helpers.js';

describe('billing + invoicing flow (workflow 4, integration)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function setup() {
    const { store, cleanup } = freshStore();
    cleanups.push(cleanup);
    // seed gives us a provider_profile, the code picklist (CPT + ICD-10), and clients.
    const seed = seedSynthetic(store);
    const guard = new EgressGuard(silentLogger);
    const service = new BillingService({
      billing: store.billing,
      audit: store.audit,
      guard,
      dataMode: () => 'synthetic',
    });
    const clientId = seed.clientIds[0];
    const cpt = service.codeItems({ code_type: 'CPT' }).find((c) => c.code === '90834')!;
    const icd = service.codeItems({ code_type: 'ICD10' }).find((c) => c.code === 'F41.1')!;
    return { store, service, clientId, cptId: cpt.id, icdId: icd.id };
  }

  it('generates an invoice from a service line with the total in integer cents', () => {
    const { service, clientId, cptId, icdId } = setup();
    const detail = service.generateInvoice({
      client_id: clientId,
      document_type: 'invoice',
      issue_date: '2026-06-17',
      lines: [
        {
          date_of_service: '2026-06-17',
          cpt_code_id: cptId,
          icd10_code_id: icdId,
          place_of_service_code: '10',
          duration_minutes: 45,
          description: 'Psychotherapy, 45 minutes.',
          fee_cents: 15000, // $150.00
        },
      ],
    });
    expect(detail.invoice.document_type).toBe('invoice');
    expect(detail.invoice.total_amount).toBe(15000); // integer cents
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0].fee_cents).toBe(15000);
    expect(detail.balance_cents).toBe(15000); // nothing paid yet
    expect(Number.isInteger(detail.balance_cents)).toBe(true);
    expect(detail.provider).not.toBeNull(); // CMS-1500 header source present
    expect(detail.disclaimer).toBe(DISCLAIMERS.billingBoundary);
  });

  it('rejects a service line whose code is not a real FK picklist item (never free text)', () => {
    const { service, clientId } = setup();
    expect(() =>
      service.generateInvoice({
        client_id: clientId,
        document_type: 'invoice',
        issue_date: '2026-06-17',
        lines: [
          {
            date_of_service: '2026-06-17',
            cpt_code_id: 'not-a-real-code-id', // free-text-ish bogus id
            description: 'Bogus.',
            fee_cents: 10000,
          },
        ],
      })
    ).toThrowError(/code/i);
  });

  it('generates a superbill with the provider header and the billing-boundary disclaimer', () => {
    const { service, clientId, cptId, icdId } = setup();
    const detail = service.generateSuperbill({
      client_id: clientId,
      document_type: 'superbill',
      issue_date: '2026-06-17',
      lines: [
        {
          date_of_service: '2026-06-17',
          cpt_code_id: cptId,
          icd10_code_id: icdId,
          description: 'Psychotherapy, 45 minutes.',
          fee_cents: 15000,
        },
      ],
    });
    expect(detail.invoice.document_type).toBe('superbill');
    expect(detail.provider).not.toBeNull();
    expect(detail.provider!.npi).toBe('0000000000'); // placeholder NPI from seed
    // the in-app boundary statement is present for the renderer to show
    expect(detail.disclaimer).toBe(DISCLAIMERS.billingBoundary);
    expect(detail.disclaimer.toLowerCase()).toContain('does not');
  });

  it('records a payment as a bookkeeping ROW: balance drops by exact cents, no money moved', () => {
    const { service, clientId, cptId } = setup();
    const created = service.generateInvoice({
      client_id: clientId,
      document_type: 'invoice',
      issue_date: '2026-06-17',
      lines: [
        {
          date_of_service: '2026-06-17',
          cpt_code_id: cptId,
          description: 'Psychotherapy, 45 minutes.',
          fee_cents: 15000,
        },
      ],
    });

    const afterPartial = service.recordPayment({
      invoice_id: created.invoice.id,
      amount_cents: 5000, // $50.00
      method: 'card',
      paid_at: '2026-06-17',
    });
    expect(afterPartial.balance_cents).toBe(10000); // 15000 - 5000, integer
    expect(afterPartial.invoice.status).toBe('partial');
    expect(afterPartial.payments).toHaveLength(1);

    const afterFull = service.recordPayment({
      invoice_id: created.invoice.id,
      amount_cents: 10000,
      method: 'cash',
      paid_at: '2026-06-17',
    });
    expect(afterFull.balance_cents).toBe(0);
    expect(afterFull.invoice.status).toBe('paid');

    // THE GUARANTEE: no charge / claims-submission method exists on the service.
    expect((service as unknown as Record<string, unknown>).chargeCard).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).submitClaim).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).processPayment).toBeUndefined();
  });

  it('AI statement-summary stub is offline and dash-free (F5)', () => {
    const { service, clientId, cptId } = setup();
    const created = service.generateInvoice({
      client_id: clientId,
      document_type: 'invoice',
      issue_date: '2026-06-17',
      lines: [
        {
          date_of_service: '2026-06-17',
          cpt_code_id: cptId,
          description: 'Psychotherapy, 45 minutes.',
          fee_cents: 15000,
        },
      ],
    });
    const { summary } = service.draftStatementSummary(created.invoice.id);
    expect(summary.length).toBeGreaterThan(0);
    expect(hasProhibitedDash(summary)).toBe(false);
    expect(summary).toContain('150.00'); // dollar amount rendered from integer cents
  });

  it('audit records billing actions with metadata only (F4)', () => {
    const { store, service, clientId, cptId } = setup();
    const created = service.generateInvoice({
      client_id: clientId,
      document_type: 'invoice',
      issue_date: '2026-06-17',
      lines: [
        {
          date_of_service: '2026-06-17',
          cpt_code_id: cptId,
          description: 'sensitive description that must not be logged',
          fee_cents: 15000,
        },
      ],
    });
    service.recordPayment({
      invoice_id: created.invoice.id,
      amount_cents: 5000,
      method: 'card',
      paid_at: '2026-06-17',
    });
    const rows = store.audit.recent(50);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('invoice_generate');
    expect(actions).toContain('payment_record');
    for (const r of rows) {
      expect(r.summary ?? '').not.toContain('sensitive description');
    }
  });
});
