// billingRepository: the ONLY code that writes invoice / service_line / payment SQL,
// and the read access for code_item + provider_profile that billing needs.
//
// INVOICE-CENTRIC (binding F3): invoice -> service_line(invoice_id) ->
// payment(invoice_id). Money is INTEGER cents everywhere (the schema enforces this;
// this repo never sees a float). Codes are FK ids into code_item, never free text.
// NPI + practice identifiers come from provider_profile.
//
// HARD BOUNDARY (safety floor + hard rule 8): this repo records documents and
// payments the therapist ENTERED. It never submits a claim and never moves money;
// recordPayment writes a payment ROW (a bookkeeping entry), it does not charge a
// card or transfer funds.

import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import type {
  Invoice,
  InvoiceDocumentType,
  InvoiceStatus,
  ServiceLine,
  Payment,
  PaymentMethod,
  CodeItem,
  CodeType,
  ProviderProfile,
  ClientAddress,
} from '@shared/types/domain.js';
import { type Clock, type IdGen, parseJson } from './support.js';

// ── row shapes ──
interface InvoiceRow {
  id: string;
  client_id: string;
  document_type: InvoiceDocumentType;
  issue_date: string;
  status: InvoiceStatus;
  total_amount_cents: number;
  demo: number;
  created_at: string;
  updated_at: string;
}
function rowToInvoice(r: InvoiceRow): Invoice {
  return {
    id: r.id,
    client_id: r.client_id,
    document_type: r.document_type,
    issue_date: r.issue_date,
    status: r.status,
    total_amount: r.total_amount_cents,
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

interface ServiceLineRow {
  id: string;
  invoice_id: string;
  appointment_id: string | null;
  client_id: string;
  date_of_service: string;
  cpt_code_id: string | null;
  icd10_code_id: string | null;
  place_of_service_code: string | null;
  duration_minutes: number | null;
  description: string;
  fee_cents: number;
  amount_paid_cents: number;
  created_at: string;
}
function rowToLine(r: ServiceLineRow): ServiceLine {
  return {
    id: r.id,
    invoice_id: r.invoice_id,
    appointment_id: r.appointment_id,
    client_id: r.client_id,
    date_of_service: r.date_of_service,
    cpt_code_id: r.cpt_code_id,
    icd10_code_id: r.icd10_code_id,
    place_of_service_code: r.place_of_service_code,
    duration_minutes: r.duration_minutes,
    description: r.description,
    fee_cents: r.fee_cents,
    amount_paid_cents: r.amount_paid_cents,
    created_at: r.created_at,
  };
}

interface PaymentRow {
  id: string;
  invoice_id: string;
  amount_cents: number;
  method: PaymentMethod;
  paid_at: string;
  note: string | null;
  demo: number;
  created_at: string;
}
function rowToPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    invoice_id: r.invoice_id,
    amount_cents: r.amount_cents,
    method: r.method,
    paid_at: r.paid_at,
    note: r.note,
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
  };
}

interface CodeRow {
  id: string;
  code_type: CodeType;
  code: string;
  label: string;
  active: number;
  demo: number;
  created_at: string;
  updated_at: string;
}
function rowToCode(r: CodeRow): CodeItem {
  return {
    id: r.id,
    code_type: r.code_type,
    code: r.code,
    label: r.label,
    active: r.active === 1,
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

interface ProviderRow {
  id: string;
  legal_name: string;
  credential: string;
  license_number: string;
  license_state: string;
  npi: string;
  tax_id: string;
  practice_address_json: string | null;
  signature_display: string;
  created_at: string;
  updated_at: string;
}
function rowToProvider(r: ProviderRow): ProviderProfile {
  return {
    id: r.id,
    legal_name: r.legal_name,
    credential: r.credential,
    license_number: r.license_number,
    license_state: r.license_state,
    npi: r.npi,
    tax_id: r.tax_id,
    practice_address: parseJson<ClientAddress | null>(r.practice_address_json, null),
    signature_display: r.signature_display,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ── inputs ──
export interface ServiceLineInput {
  appointment_id?: string | null;
  date_of_service: string;
  cpt_code_id?: string | null;
  icd10_code_id?: string | null;
  place_of_service_code?: string | null;
  duration_minutes?: number | null;
  description: string;
  fee_cents: number;
}
export interface CreateInvoiceInput {
  client_id: string;
  document_type: InvoiceDocumentType;
  issue_date: string;
  lines: ServiceLineInput[];
  demo?: 0 | 1;
}
export interface RecordPaymentInput {
  invoice_id: string;
  amount_cents: number;
  method: PaymentMethod;
  paid_at: string;
  note?: string | null;
  demo?: 0 | 1;
}

export class BillingRepository {
  constructor(
    private readonly db: DB,
    private readonly clock: Clock,
    private readonly ids: IdGen
  ) {}

  // ── invoice + its service lines ──
  /** Create an invoice (or superbill) and its service lines in one transaction.
   * total_amount_cents is the SUM of line fees, computed in integer cents. */
  createInvoice(input: CreateInvoiceInput): Invoice {
    const now = this.clock.nowIso();
    const invoiceId = this.ids.next();
    const total = input.lines.reduce((sum, l) => sum + Math.trunc(l.fee_cents), 0);

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO invoice
            (id, client_id, document_type, issue_date, status, total_amount_cents,
             demo, created_at, updated_at)
           VALUES
            (@id, @client_id, @document_type, @issue_date, 'issued', @total,
             @demo, @now, @now)`
        )
        .run({
          id: invoiceId,
          client_id: input.client_id,
          document_type: input.document_type,
          issue_date: input.issue_date,
          total,
          demo: input.demo ?? 0,
          now,
        });

      for (const line of input.lines) {
        this.db
          .prepare(
            `INSERT INTO service_line
              (id, invoice_id, appointment_id, client_id, date_of_service, cpt_code_id,
               icd10_code_id, place_of_service_code, duration_minutes, description,
               fee_cents, amount_paid_cents, created_at)
             VALUES
              (@id, @invoice_id, @appointment_id, @client_id, @date_of_service, @cpt,
               @icd10, @pos, @duration, @description, @fee, 0, @now)`
          )
          .run({
            id: this.ids.next(),
            invoice_id: invoiceId,
            appointment_id: line.appointment_id ?? null,
            client_id: input.client_id,
            date_of_service: line.date_of_service,
            cpt: line.cpt_code_id ?? null,
            icd10: line.icd10_code_id ?? null,
            pos: line.place_of_service_code ?? null,
            duration: line.duration_minutes ?? null,
            description: line.description,
            fee: Math.trunc(line.fee_cents),
            now,
          });
      }
    });
    tx();
    return this.getInvoice(invoiceId)!;
  }

  getInvoice(id: string): Invoice | null {
    const r = this.db.prepare('SELECT * FROM invoice WHERE id = ?').get(id) as
      | InvoiceRow
      | undefined;
    return r ? rowToInvoice(r) : null;
  }

  listInvoices(): Invoice[] {
    const rows = this.db
      .prepare('SELECT * FROM invoice ORDER BY created_at DESC')
      .all() as InvoiceRow[];
    return rows.map(rowToInvoice);
  }

  serviceLines(invoiceId: string): ServiceLine[] {
    const rows = this.db
      .prepare('SELECT * FROM service_line WHERE invoice_id = ? ORDER BY created_at ASC')
      .all(invoiceId) as ServiceLineRow[];
    return rows.map(rowToLine);
  }

  // ── payments ──
  /** Record a payment ROW against an invoice (bookkeeping; no money is moved), then
   * recompute and persist the invoice status from total vs. paid. */
  recordPayment(input: RecordPaymentInput): Payment {
    const now = this.clock.nowIso();
    const id = this.ids.next();
    this.db
      .prepare(
        `INSERT INTO payment (id, invoice_id, amount_cents, method, paid_at, note, demo, created_at)
         VALUES (@id, @invoice_id, @amount, @method, @paid_at, @note, @demo, @now)`
      )
      .run({
        id,
        invoice_id: input.invoice_id,
        amount: Math.trunc(input.amount_cents),
        method: input.method,
        paid_at: input.paid_at,
        note: input.note ?? null,
        demo: input.demo ?? 0,
        now,
      });
    this.recomputeInvoiceStatus(input.invoice_id);
    const r = this.db.prepare('SELECT * FROM payment WHERE id = ?').get(id) as PaymentRow;
    return rowToPayment(r);
  }

  payments(invoiceId: string): Payment[] {
    const rows = this.db
      .prepare('SELECT * FROM payment WHERE invoice_id = ? ORDER BY paid_at ASC')
      .all(invoiceId) as PaymentRow[];
    return rows.map(rowToPayment);
  }

  /** total paid for an invoice in integer cents. */
  totalPaidCents(invoiceId: string): number {
    const r = this.db
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payment WHERE invoice_id = ?')
      .get(invoiceId) as { paid: number };
    return r.paid;
  }

  /** Set invoice.status from the balance: paid / partial / issued. Never moves money. */
  private recomputeInvoiceStatus(invoiceId: string): void {
    const inv = this.getInvoice(invoiceId);
    if (!inv) return;
    const paid = this.totalPaidCents(invoiceId);
    let status: InvoiceStatus = 'issued';
    if (paid <= 0) status = 'issued';
    else if (paid >= inv.total_amount) status = 'paid';
    else status = 'partial';
    this.db
      .prepare('UPDATE invoice SET status = @status, updated_at = @now WHERE id = @id')
      .run({ id: invoiceId, status, now: this.clock.nowIso() });
  }

  // ── code_item (FK picklist; read-only here, never advisory) ──
  codeItems(filter?: { code_type?: string }): CodeItem[] {
    const rows = (
      filter?.code_type
        ? this.db
            .prepare('SELECT * FROM code_item WHERE code_type = ? AND active = 1 ORDER BY code')
            .all(filter.code_type)
        : this.db
            .prepare('SELECT * FROM code_item WHERE active = 1 ORDER BY code_type, code')
            .all()
    ) as CodeRow[];
    return rows.map(rowToCode);
  }

  codeById(id: string): CodeItem | null {
    const r = this.db.prepare('SELECT * FROM code_item WHERE id = ?').get(id) as
      | CodeRow
      | undefined;
    return r ? rowToCode(r) : null;
  }

  // ── provider_profile (single row in v1; she enters NPI/tax id) ──
  providerProfile(): ProviderProfile | null {
    const r = this.db.prepare('SELECT * FROM provider_profile LIMIT 1').get() as
      | ProviderRow
      | undefined;
    return r ? rowToProvider(r) : null;
  }
}
