// billingService: the billing + invoicing workflow (module C), matching the notes
// module's depth. INVOICE-CENTRIC: invoice -> service_line -> payment, money in
// INTEGER cents end to end.
//
// What it does:
//   * generateInvoice / generateSuperbill from synthetic service lines (codes are FK
//     ids into code_item, never free text; NPI + practice ids come from
//     provider_profile),
//   * recordPayment against an invoice (a bookkeeping ROW; no money is moved),
//   * getInvoice -> the invoice + lines + payments + a balance computed in integer
//     cents + the CMS-1500-compatible provider header for self-submission,
//   * draftStatementSummary: an AI stub (purpose 'statement_summary') through the
//     guard, Mock/offline, dash-free.
//
// HARD BOUNDARY (safety floor + hard rule 8): the app GENERATES documents the client
// can self-submit. It does NOT submit insurance claims and does NOT process payments
// or move money. The InvoiceDetail carries the in-app disclaimer that states this.

import type {
  Invoice,
  InvoiceDocumentType,
  CodeItem,
  ProviderProfile,
} from '@shared/types/domain.js';
import type {
  InvoiceDetail,
  ServiceLineInput,
  GenerateInvoiceReq,
  RecordPaymentReq,
} from '@shared/types/ipc.js';
import type { DataMode } from '@shared/constants.js';
import type { BillingRepository } from '@main/data/repositories/billingRepository.js';
import type { AuditRepository } from '@main/data/repositories/auditRepository.js';
import type { EgressGuard } from '@main/agent/egressGuard.js';
import { stripDashes } from '@main/agent/textPostProcess.js';
import { DISCLAIMERS } from '@shared/disclaimers.js';

export interface BillingServiceDeps {
  billing: BillingRepository;
  audit: AuditRepository;
  guard: EgressGuard;
  dataMode: () => DataMode;
}

export class BillingService {
  constructor(private readonly deps: BillingServiceDeps) {}

  listInvoices(): Invoice[] {
    return this.deps.billing.listInvoices();
  }

  codeItems(filter?: { code_type?: string }): CodeItem[] {
    return this.deps.billing.codeItems(filter);
  }

  providerProfile(): ProviderProfile | null {
    return this.deps.billing.providerProfile();
  }

  /** Read an invoice with everything needed to display and self-submit, including a
   * balance in INTEGER cents and the claims/payment-boundary disclaimer. */
  getInvoice(id: string): InvoiceDetail | null {
    const invoice = this.deps.billing.getInvoice(id);
    if (!invoice) return null;
    const lines = this.deps.billing.serviceLines(id);
    const payments = this.deps.billing.payments(id);
    const paid = this.deps.billing.totalPaidCents(id);
    return {
      invoice,
      lines,
      payments,
      provider: this.deps.billing.providerProfile(),
      balance_cents: invoice.total_amount - paid, // integer cents, never a float
      disclaimer: DISCLAIMERS.billingBoundary,
    };
  }

  /** Generate an invoice from service lines. Codes must be FK ids (validated
   * against code_item); a free-text code is rejected so the boundary holds. */
  generateInvoice(req: GenerateInvoiceReq): InvoiceDetail {
    return this.generate(req, 'invoice');
  }

  /** Generate a superbill (the document a client submits to their insurer). Same
   * data as an invoice; document_type differs so the renderer can show the
   * CMS-1500-style header + the self-submit framing. */
  generateSuperbill(req: GenerateInvoiceReq): InvoiceDetail {
    return this.generate(req, 'superbill');
  }

  private generate(req: GenerateInvoiceReq, type: InvoiceDocumentType): InvoiceDetail {
    if (!req.lines.length) throw new Error('An invoice needs at least one service line.');
    this.assertCodesArePicklist(req.lines);

    const issue = req.issue_date ?? new Date().toISOString().slice(0, 10);
    const invoice = this.deps.billing.createInvoice({
      client_id: req.client_id,
      document_type: type,
      issue_date: issue,
      lines: req.lines.map((l) => ({
        appointment_id: l.appointment_id ?? null,
        date_of_service: l.date_of_service,
        cpt_code_id: l.cpt_code_id ?? null,
        icd10_code_id: l.icd10_code_id ?? null,
        place_of_service_code: l.place_of_service_code ?? null,
        duration_minutes: l.duration_minutes ?? null,
        description: l.description,
        fee_cents: Math.trunc(l.fee_cents),
      })),
      demo: 0,
    });
    // F4: log doc type + line count + total cents (a number), never client detail.
    this.deps.audit.record(
      type === 'superbill' ? 'superbill_generate' : 'invoice_generate',
      'invoice',
      invoice.id,
      `lines=${req.lines.length} total_cents=${invoice.total_amount}`
    );
    return this.getInvoice(invoice.id)!;
  }

  /** Record a payment ROW (bookkeeping) and return the refreshed invoice + balance.
   * This never charges a card and never moves money; it logs that money was
   * received outside the app. */
  recordPayment(req: RecordPaymentReq): InvoiceDetail {
    if (req.amount_cents <= 0) throw new Error('Payment amount must be greater than zero.');
    const paidAt = req.paid_at ?? new Date().toISOString().slice(0, 10);
    const payment = this.deps.billing.recordPayment({
      invoice_id: req.invoice_id,
      amount_cents: Math.trunc(req.amount_cents),
      method: req.method,
      paid_at: paidAt,
      note: req.note ?? null,
      demo: 0,
    });
    this.deps.audit.record(
      'payment_record',
      'payment',
      payment.id,
      `invoice=${req.invoice_id} cents=${payment.amount_cents} method=${payment.method}`
    );
    return this.getInvoice(req.invoice_id)!;
  }

  /**
   * AI ASSIST (stub, through the guard, purpose 'statement_summary'). Drafts a
   * plain-language statement summary LINE for an invoice. Minimum-necessary: only
   * the balance (a number) goes in the request, never the client or the codes. It
   * routes through the SAME EgressGuard, offline (Mock/no spend), dash-free (F5). It
   * does NOT advise on codes, coverage, or claims.
   */
  draftStatementSummary(invoiceId: string): { summary: string } {
    const detail = this.getInvoice(invoiceId);
    if (!detail) throw new Error('Invoice not found.');

    const decision = this.deps.guard.guard({
      purpose: 'statement_summary',
      system:
        'Write a one-line, neutral statement summary of an amount due for therapy ' +
        'services. Do not advise on codes, insurance coverage, or claims. Do not ' +
        'include any names or identifiers.',
      messages: [
        {
          role: 'user',
          content: `Summarize a ${detail.invoice.document_type} with balance in cents: ${detail.balance_cents}.`,
        },
      ],
      maxTokens: 200,
      mode: this.deps.dataMode(),
    });
    if (!decision.allowed) {
      const err = new Error(decision.reason ?? 'Egress not allowed.');
      (err as NodeJS.ErrnoException).code = decision.code;
      throw err;
    }

    const balance = (detail.balance_cents / 100).toFixed(2);
    const total = (detail.invoice.total_amount / 100).toFixed(2);
    const noun = detail.invoice.document_type === 'superbill' ? 'superbill' : 'statement';
    const summary = stripDashes(
      detail.balance_cents <= 0
        ? `This ${noun} is paid in full. Total billed was $${total}. ` +
            'Please retain it for your records.'
        : `Balance due on this ${noun} is $${balance} of a $${total} total for ` +
            'services rendered. Please review the itemized lines and remit at your ' +
            'convenience.'
    );

    this.deps.audit.record(
      'statement_summary',
      'invoice',
      invoiceId,
      `bytes=${decision.meta?.bytes ?? 0}`
    );
    return { summary };
  }

  /** Guard the code boundary: every supplied code id must resolve to a code_item of
   * the right type. This makes "codes are an FK picklist, never free text" a runtime
   * invariant, not just a schema hope. */
  private assertCodesArePicklist(lines: ServiceLineInput[]): void {
    for (const l of lines) {
      if (l.cpt_code_id) {
        const c = this.deps.billing.codeById(l.cpt_code_id);
        if (!c || c.code_type !== 'CPT') {
          throw new Error('Each CPT code must be chosen from the code list.');
        }
      }
      if (l.icd10_code_id) {
        const c = this.deps.billing.codeById(l.icd10_code_id);
        if (!c || c.code_type !== 'ICD10') {
          throw new Error('Each diagnosis code must be chosen from the code list.');
        }
      }
    }
  }
}
