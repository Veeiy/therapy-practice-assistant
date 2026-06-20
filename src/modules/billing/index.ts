// billing module: FUNCTIONAL this wave (workflow 4 of 4). Invoicing + superbills.
//
// Thin handlers over the BillingService. The service owns the INVOICE-CENTRIC model
// (invoice -> service_line -> payment, money in INTEGER cents), the FK code picklist
// guard (codes are code_item ids, never free text), the CMS-1500-compatible provider
// header from provider_profile, the in-app billing-boundary disclaimer, and the
// guard-routed AI statement-summary stub.
//
// HARD BOUNDARY (safety floor + hard rule 8): this app GENERATES invoices and
// superbills the client can self-submit. It has NO submitClaim and NO chargeCard /
// processPayment handler. recordPayment writes a BOOKKEEPING ROW only; it never moves
// money. The InvoiceDetail carries DISCLAIMERS.billingBoundary so the boundary is
// visible in the UI, not just in code.

import type { WorkflowModule } from '@shared/types/module.js';
import type { IpcRouter } from '@shared/types/ipc.js';
import type {
  GenerateInvoiceReq,
  RecordPaymentReq,
} from '@shared/types/ipc.js';
import { CHANNELS } from '@shared/constants.js';
import type { BillingService } from './billingService.js';

export interface BillingModuleDeps {
  service: BillingService;
}

export function createBillingModule(deps: BillingModuleDeps): WorkflowModule {
  return {
    id: 'billing',
    title: 'Billing',
    icon: 'receipt',
    functional: true,

    defaultConfig: {
      billing: {
        // money is integer cents everywhere; this is just the display currency.
        currency: 'USD',
        // shown on the generated statement footer; non-PHI, operator-editable.
        statementFooter: 'Thank you. Please retain this statement for your records.',
      },
    },

    registerIpc(router: IpcRouter): void {
      router.handle(CHANNELS.billingListInvoices, () => deps.service.listInvoices());

      router.handle(CHANNELS.billingGetInvoice, (req: { id: string }) =>
        deps.service.getInvoice(req.id)
      );

      router.handle(CHANNELS.billingCodeItems, (req: { code_type?: string } = {}) =>
        deps.service.codeItems(req)
      );

      router.handle(CHANNELS.billingProviderProfile, () => deps.service.providerProfile());

      // ── document generation (invoice + the superbill self-submit variant) ──
      router.handle(CHANNELS.billingGenerateInvoice, (req: GenerateInvoiceReq) =>
        deps.service.generateInvoice(req)
      );

      router.handle(CHANNELS.billingGenerateSuperbill, (req: GenerateInvoiceReq) =>
        deps.service.generateSuperbill(req)
      );

      // recordPayment is a BOOKKEEPING ROW only. No money is moved (safety floor).
      router.handle(CHANNELS.billingRecordPayment, (req: RecordPaymentReq) =>
        deps.service.recordPayment(req)
      );

      // AI stub (purpose 'statement_summary'), guard-routed, offline, dash-free.
      router.handle(CHANNELS.billingDraftStatementSummary, (req: { invoice_id: string }) =>
        deps.service.draftStatementSummary(req.invoice_id)
      );
    },
  };
}
