// Canonical domain types.
// Source of truth: product-workflow.md SECTION 4 (declared canonical by the audit
// gate, fix F3). Every table in 0001_init.sql has a matching type here.
//
// PHI rule carried into the type system: free-text PHI lives only in body/value
// fields (presenting_concern, sections[].body, goal_text, ...). It never appears
// in a key, an enum value, or a column name. The shapes below make that visible.

export type Uuid = string;
/** ISO-8601 date-time string. SQLite stores TEXT; we keep ISO strings everywhere. */
export type IsoDateTime = string;
/** ISO-8601 date (YYYY-MM-DD). */
export type IsoDate = string;

/** 1 = obviously fictional demo/seed record (hard rule 4). 0 = a real record. */
export type DemoFlag = 0 | 1;

// ── client ──────────────────────────────────────────────────────────────────
export type PreferredContact = 'email' | 'phone' | 'none';
export type ClientStatus = 'active' | 'inactive';

export interface ClientAddress {
  street?: string;
  city?: string;
  state?: string;
  postal?: string;
}
export interface EmergencyContact {
  name?: string;
  relationship?: string;
  phone?: string;
}

export interface Client {
  id: Uuid;
  legal_first_name: string;
  legal_last_name: string;
  preferred_name: string | null;
  pronouns: string | null;
  date_of_birth: IsoDate | null;
  email: string | null;
  phone: string | null;
  preferred_contact_method: PreferredContact;
  address: ClientAddress | null;
  emergency_contact: EmergencyContact | null;
  presenting_concern: string | null;
  status: ClientStatus;
  consent_on_file: boolean;
  consent_date: IsoDate | null;
  /** config-driven optional fields (extensibility). */
  custom_fields: Record<string, unknown>;
  demo: DemoFlag;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── appointment ───────────────────────────────────────────────────────────────
export type Modality = 'in_person' | 'telehealth';
export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'cancelled_by_client'
  | 'cancelled_by_clinician';
/** Denormalized convenience status on the appointment row (F4). The normalized
 * source of truth is the reminder table; this mirrors its latest state. */
export type AppointmentReminderStatus = 'none' | 'scheduled' | 'sent' | 'failed';

export interface Appointment {
  id: Uuid;
  client_id: Uuid;
  starts_at: IsoDateTime;
  duration_minutes: number;
  modality: Modality;
  location: string | null;
  telehealth_link: string | null;
  service_type: string | null;
  status: AppointmentStatus;
  recurrence_rule: string | null;
  fee_flag: boolean;
  reminder_status: AppointmentReminderStatus;
  custom_fields: Record<string, unknown>;
  demo: DemoFlag;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── reminder (F4: one canonical normalized model) ─────────────────────────────
export type ReminderChannel = 'email'; // email-only in v1; sms is a future channel
export type ReminderStatus = 'scheduled' | 'sent' | 'failed';

export interface Reminder {
  id: Uuid;
  appointment_id: Uuid;
  channel: ReminderChannel;
  send_at: IsoDateTime;
  status: ReminderStatus;
  /** which template config produced the body. Body text is built locally, never
   * the client name in the model prompt (F7). */
  template_id: string;
  last_error: string | null;
  demo: DemoFlag;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── note (the centerpiece) ────────────────────────────────────────────────────
export type NoteFormat = 'SOAP' | 'DAP' | 'BIRP';
/** F2: 'signed' is the ONE canonical lock predicate. A note is immutable iff
 * status === 'signed'. There is no separate locked column. */
export type NoteStatus = 'draft' | 'signed';

/** A section body. KEY and LABEL are generic (no PHI); only `body` holds PHI. */
export interface NoteSection {
  key: string; // e.g. 'subjective'
  label: string; // e.g. 'Subjective'
  body: string; // PHI lives here, and only here
}

export interface Note {
  id: Uuid;
  client_id: Uuid;
  appointment_id: Uuid | null;
  treatment_plan_goal_id: Uuid | null;
  diagnosis_code_id: Uuid | null; // FK -> code_item (picklist), never free text (F3)
  format: NoteFormat;
  status: NoteStatus;
  date_of_service: IsoDate | null;
  session_start: string | null; // HH:MM
  duration_minutes: number | null;
  modality: Modality | null;
  place_of_service_code: string | null;
  sections: NoteSection[];
  /** F3: the therapist's original brain-dump, retained locally for re-draft/audit.
   * Never leaves the device after the (synthetic, this build) draft call. */
  shorthand_input: string | null;
  /** F3: true if an AI draft tool was used (transparency). */
  ai_assisted: boolean;
  signed_by: string | null;
  signed_at: IsoDateTime | null;
  demo: DemoFlag;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** Append-only correction. The parent note row is immutable; corrections are
 * child rows that carry author + timestamp. No edit, no delete on an addendum. */
export interface NoteAddendum {
  id: Uuid;
  note_id: Uuid;
  author: string;
  body: string;
  created_at: IsoDateTime;
}

// ── intake_record (F3: declared now, UI next wave) ────────────────────────────
export interface InsuranceInfo {
  carrier?: string;
  member_id?: string;
  group?: string;
  subscriber?: string;
}
export interface IntakeRecord {
  id: Uuid;
  client_id: Uuid;
  prior_therapy: string | null;
  hospitalizations: string | null;
  current_medications: string | null;
  substance_use: string | null;
  family_mh_history: string | null;
  insurance: InsuranceInfo | null;
  consent_acknowledged: boolean;
  consent_acknowledged_date: IsoDate | null;
  custom_fields: Record<string, unknown>;
  demo: DemoFlag;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── treatment_plan + treatment_plan_goal (F3: declared now) ───────────────────
export type TreatmentPlanStatus = 'active' | 'completed' | 'archived';
export interface TreatmentPlan {
  id: Uuid;
  client_id: Uuid;
  title: string;
  status: TreatmentPlanStatus;
  demo: DemoFlag;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}
export type GoalStatus = 'not_started' | 'in_progress' | 'met' | 'discontinued';
export interface TreatmentPlanGoal {
  id: Uuid;
  treatment_plan_id: Uuid;
  goal_text: string;
  target_date: IsoDate | null;
  status: GoalStatus;
  demo: DemoFlag;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── provider_profile (single row in v1) ───────────────────────────────────────
export interface ProviderProfile {
  id: Uuid;
  legal_name: string;
  credential: string;
  license_number: string;
  license_state: string;
  npi: string;
  tax_id: string;
  practice_address: ClientAddress | null;
  signature_display: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── code_item (user-maintained CPT/ICD-10/POS picklist; F3 FK target) ─────────
export type CodeType = 'CPT' | 'ICD10' | 'POS';
export interface CodeItem {
  id: Uuid;
  code_type: CodeType;
  code: string;
  label: string;
  active: boolean;
  demo: DemoFlag;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ── billing: INVOICE-CENTRIC (F3). invoice -> service_line -> payment ──────────
export type InvoiceDocumentType = 'invoice' | 'superbill';
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'partial' | 'void';
export interface Invoice {
  id: Uuid;
  client_id: Uuid;
  document_type: InvoiceDocumentType;
  issue_date: IsoDate;
  status: InvoiceStatus;
  total_amount: number; // cents (integer money, see service_line)
  demo: DemoFlag;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ServiceLine {
  id: Uuid;
  invoice_id: Uuid; // F3: service_line belongs to an invoice
  appointment_id: Uuid | null;
  client_id: Uuid;
  date_of_service: IsoDate;
  cpt_code_id: Uuid | null; // FK -> code_item (she picks; app never advises)
  icd10_code_id: Uuid | null; // FK -> code_item
  place_of_service_code: string | null;
  duration_minutes: number | null;
  description: string;
  /** money in integer cents to avoid float drift. */
  fee_cents: number;
  amount_paid_cents: number;
  created_at: IsoDateTime;
}

export type PaymentMethod = 'cash' | 'card' | 'check' | 'other';
export interface Payment {
  id: Uuid;
  invoice_id: Uuid; // F3: payment belongs to an invoice
  amount_cents: number;
  method: PaymentMethod;
  paid_at: IsoDate;
  note: string | null;
  demo: DemoFlag;
  created_at: IsoDateTime;
}

// ── document_attachment (intake uploads / files) ──────────────────────────────
export interface DocumentAttachment {
  id: Uuid;
  client_id: Uuid | null;
  label: string;
  /** reference to the locally encrypted blob (blobStore). */
  blob_uuid: string;
  filename: string;
  mime: string;
  iv: string; // base64 GCM iv
  auth_tag: string; // base64 GCM tag
  demo: DemoFlag;
  created_at: IsoDateTime;
}

// ── audit_log (non-PHI metadata trail) ────────────────────────────────────────
export interface AuditLogRow {
  id: Uuid;
  at: IsoDateTime;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  /** summary is a non-PHI metadata string (counts, ids, byte sizes). Never body
   * text, never prompt or response content (F4 logging hygiene). */
  summary: string | null;
}
