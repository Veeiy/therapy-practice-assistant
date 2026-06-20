// BillingScreen: the functional billing + invoicing workflow (workflow 4). It
// crosses window.api.billing to the BillingService:
//
//   pick a client + code (from the FK picklist) + fee  ->  generate invoice OR superbill
//   open an invoice  ->  invoice + lines + payments + balance (integer cents) + the
//                        CMS-1500-style provider header + the boundary disclaimer
//   record a payment ->  a bookkeeping ROW; the balance drops; NO money is moved
//
// HARD BOUNDARY, visible in the UI: codes are chosen from a picklist (never typed
// free text); there is NO "submit claim" and NO "charge card" button. The disclaimer
// returned with every invoice is shown prominently: this generates documents the
// client self-submits; it does not file claims and does not process payments.

import React, { useCallback, useEffect, useState } from 'react';
import type { Client, CodeItem, Invoice } from '../../shared/types/domain.js';
import type { InvoiceDetail } from '../../shared/types/ipc.js';

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BillingScreen(): React.ReactElement {
  const [clients, setClients] = useState<Client[]>([]);
  const [cptCodes, setCptCodes] = useState<CodeItem[]>([]);
  const [icdCodes, setIcdCodes] = useState<CodeItem[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [active, setActive] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // new-invoice form
  const [clientId, setClientId] = useState('');
  const [cptId, setCptId] = useState('');
  const [icdId, setIcdId] = useState('');
  const [feeDollars, setFeeDollars] = useState('150.00');
  const [docType, setDocType] = useState<'invoice' | 'superbill'>('invoice');

  // payment form
  const [payDollars, setPayDollars] = useState('');

  const reload = useCallback(async () => {
    const [cs, cpt, icd, inv] = await Promise.all([
      window.api.clients.list(),
      window.api.billing.codeItems({ code_type: 'CPT' }),
      window.api.billing.codeItems({ code_type: 'ICD10' }),
      window.api.billing.listInvoices(),
    ]);
    setClients(cs);
    setCptCodes(cpt);
    setIcdCodes(icd);
    setInvoices(inv);
    setClientId((prev) => prev || (cs[0]?.id ?? ''));
    setCptId((prev) => prev || (cpt[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

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

  const feeCents = (): number => Math.round(parseFloat(feeDollars || '0') * 100);

  const generate = () =>
    run(async () => {
      if (!clientId) throw new Error('Choose a client first.');
      if (!cptId) throw new Error('Choose a procedure code from the list.');
      const cents = feeCents();
      if (!Number.isFinite(cents) || cents <= 0) throw new Error('Enter a fee greater than zero.');
      const today = new Date().toISOString().slice(0, 10);
      const req = {
        client_id: clientId,
        document_type: docType,
        issue_date: today,
        lines: [
          {
            date_of_service: today,
            cpt_code_id: cptId,
            icd10_code_id: icdId || null,
            description: cptCodes.find((c) => c.id === cptId)?.label ?? 'Service',
            fee_cents: cents,
          },
        ],
      };
      const detail =
        docType === 'superbill'
          ? await window.api.billing.generateSuperbill(req)
          : await window.api.billing.generateInvoice(req);
      setActive(detail);
      await reload();
    });

  const open = (id: string) =>
    run(async () => {
      const detail = await window.api.billing.getInvoice(id);
      setActive(detail);
    });

  const recordPayment = () =>
    run(async () => {
      if (!active) return;
      const cents = Math.round(parseFloat(payDollars || '0') * 100);
      if (!Number.isFinite(cents) || cents <= 0) throw new Error('Enter a payment greater than zero.');
      const detail = await window.api.billing.recordPayment({
        invoice_id: active.invoice.id,
        amount_cents: cents,
        method: 'card',
        paid_at: new Date().toISOString().slice(0, 10),
      });
      setActive(detail);
      setPayDollars('');
      await reload();
    });

  return (
    <div className="screen billing-screen">
      <div className="col list-col">
        <h2>Billing</h2>
        {error && <div className="banner error">{error}</div>}

        <section className="new-invoice">
          <h3>New document</h3>
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
            Procedure code (CPT)
            <select value={cptId} onChange={(e) => setCptId(e.target.value)}>
              {cptCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} - {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Diagnosis code (ICD-10, optional)
            <select value={icdId} onChange={(e) => setIcdId(e.target.value)}>
              <option value="">None</option>
              {icdCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} - {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fee (USD)
            <input
              type="text"
              inputMode="decimal"
              value={feeDollars}
              onChange={(e) => setFeeDollars(e.target.value)}
            />
          </label>
          <label>
            Document
            <select value={docType} onChange={(e) => setDocType(e.target.value as 'invoice' | 'superbill')}>
              <option value="invoice">Invoice</option>
              <option value="superbill">Superbill (client self-submits)</option>
            </select>
          </label>
          <button className="primary" onClick={generate} disabled={busy}>
            Generate
          </button>
        </section>

        <section>
          <h3>Documents</h3>
          <ul className="invoice-list">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <button className={active?.invoice.id === inv.id ? 'active' : ''} onClick={() => open(inv.id)}>
                  <span className={`pill ${inv.status}`}>{inv.status}</span>
                  {inv.document_type} {dollars(inv.total_amount)}
                  <span className="muted"> {inv.issue_date}</span>
                </button>
              </li>
            ))}
            {invoices.length === 0 && <li className="muted">No documents yet.</li>}
          </ul>
        </section>
      </div>

      <div className="col detail-col">
        {!active && <div className="empty">Generate or select a document to view it.</div>}
        {active && (
          <>
            <div className="banner info">{active.disclaimer}</div>

            <div className="invoice-head">
              <h3>
                {active.invoice.document_type === 'superbill' ? 'Superbill' : 'Invoice'}
                <span className={`pill ${active.invoice.status}`}>{active.invoice.status}</span>
              </h3>
              <div className="muted">Issued {active.invoice.issue_date}</div>
            </div>

            {active.provider && (
              <div className="provider-header">
                <div>
                  <strong>{active.provider.legal_name}</strong> ({active.provider.credential})
                </div>
                <div className="muted">
                  NPI {active.provider.npi} | Tax ID {active.provider.tax_id} | License{' '}
                  {active.provider.license_number} ({active.provider.license_state})
                </div>
              </div>
            )}

            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Code</th>
                  <th>Fee</th>
                </tr>
              </thead>
              <tbody>
                {active.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.date_of_service}</td>
                    <td>{l.description}</td>
                    <td className="muted">{l.cpt_code_id ? 'CPT/ICD on file' : ''}</td>
                    <td>{dollars(l.fee_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="totals">
              <div>Total: {dollars(active.invoice.total_amount)}</div>
              <div>
                Balance: <strong>{dollars(active.balance_cents)}</strong>
              </div>
            </div>

            <div className="payments">
              <h4>Payments (bookkeeping only; no money is moved)</h4>
              {active.payments.map((p) => (
                <div key={p.id} className="muted">
                  {p.paid_at}: {dollars(p.amount_cents)} ({p.method})
                </div>
              ))}
              {active.payments.length === 0 && <div className="muted">No payments recorded.</div>}
              <div className="record-payment">
                <input
                  type="text"
                  inputMode="decimal"
                  value={payDollars}
                  placeholder="Amount received (USD)"
                  onChange={(e) => setPayDollars(e.target.value)}
                />
                <button onClick={recordPayment} disabled={busy || !payDollars.trim()}>
                  Record payment
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
