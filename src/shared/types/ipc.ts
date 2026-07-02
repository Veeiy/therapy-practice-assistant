// Typed IPC contract shapes. The preload exposes ONLY these whitelisted calls to
// the renderer over contextBridge (contextIsolation on, no nodeIntegration). The
// renderer never touches Node, the DB, or the SDK directly.

import type {
  Note,
  NoteAddendum,
  NoteSection,
  Client,
  Appointment,
  AppointmentStatus,
  Modality,
  IntakeRecord,
  TreatmentPlan,
  TreatmentPlanGoal,
  Invoice,
  ServiceLine,
  Payment,
  CodeItem,
  ProviderProfile,
  InvoiceDocumentType,
  PaymentMethod,
} from './domain.js';
import type { ModuleDescriptor, FormFieldDef } from './module.js';
import type { DataMode } from '../constants.js';

/** What a module's register() is handed to wire its main-process handlers. */
export interface IpcRouter {
  handle<TReq, TRes>(channel: string, fn: (req: TReq) => Promise<TRes> | TRes): void;
}

// ── notes channel payloads ────────────────────────────────────────────────────
export interface CreateDraftNoteReq {
  client_id: string;
  appointment_id?: string | null;
  /** omitted means "use the provisioned notes.defaultFormat" (custom buildout). */
  format?: 'SOAP' | 'DAP' | 'BIRP';
}
export interface RequestDraftReq {
  note_id: string;
  shorthand: string;
  cues?: Record<string, unknown>;
}
export interface SaveSectionsReq {
  note_id: string;
  sections: NoteSection[];
}
export interface SignNoteReq {
  note_id: string;
  signed_by: string;
}
export interface AddAddendumReq {
  note_id: string;
  author: string;
  body: string;
}

// ── intake workflow payloads (Wave 3, module A) ───────────────────────────────
/** The config-driven intake form, returned to the renderer so the SchemaForm can
 * render whatever fields config currently defines (no rebuild to change them). */
export interface IntakeFormSpec {
  fields: FormFieldDef[];
}
/** Submit a filled intake form. `values` is keyed by FormFieldDef.key; the service
 * maps known keys to columns and everything else into custom_fields_json. */
export interface CreateIntakeReq {
  client_id: string;
  values: Record<string, unknown>;
  consent_acknowledged?: boolean;
}
/** A client's records, read together: their intake records + treatment plans
 * (each with its goals). */
export interface ClientRecords {
  intake: IntakeRecord[];
  plans: { plan: TreatmentPlan; goals: TreatmentPlanGoal[] }[];
}
export interface CreatePlanReq {
  client_id: string;
  title: string;
}
export interface AddGoalReq {
  treatment_plan_id: string;
  goal_text: string;
  target_date?: string | null;
}

// ── scheduling workflow payloads (Wave 3, module B) ───────────────────────────
export interface CreateAppointmentReq {
  client_id: string;
  starts_at: string;
  duration_minutes?: number;
  modality?: Modality;
  service_type?: string | null;
}
export interface RescheduleAppointmentReq {
  id: string;
  starts_at: string;
  duration_minutes?: number;
}
export interface CancelAppointmentReq {
  id: string;
  by: 'client' | 'clinician';
}
export interface SetAppointmentStatusReq {
  id: string;
  status: AppointmentStatus;
}
/** The exact text that WOULD be sent for an appointment, plus the channel and the
 * scheduled send time. Produced by filling the F7 minimum-necessary template; the
 * app NEVER sends it (Tier-1 staging). */
export interface ReminderPreview {
  appointment_id: string;
  channel: 'email';
  to: string | null; // the client email the operator would later send to
  send_at: string;
  subject: string;
  body: string;
  warnings: string[]; // e.g. "client has no email on file"
}
/** A staged (queued, never sent) reminder row joined with its preview text. */
export interface StagedReminder {
  id: string;
  appointment_id: string;
  channel: 'email';
  send_at: string;
  status: 'scheduled' | 'sent' | 'failed';
  preview: ReminderPreview;
}

// ── billing workflow payloads (Wave 3, module C) ──────────────────────────────
/** One service line to bill (codes are FK ids into code_item, never free text). */
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
export interface GenerateInvoiceReq {
  client_id: string;
  document_type: InvoiceDocumentType; // 'invoice' | 'superbill'
  issue_date?: string;
  lines: ServiceLineInput[];
}
export interface RecordPaymentReq {
  invoice_id: string;
  amount_cents: number;
  method: PaymentMethod;
  paid_at?: string;
  note?: string | null;
}
/** An invoice read with everything needed to display + (later) self-submit. The
 * balance is computed in INTEGER cents. */
export interface InvoiceDetail {
  invoice: Invoice;
  lines: ServiceLine[];
  payments: Payment[];
  provider: ProviderProfile | null;
  /** total_amount_cents - sum(payments). Integer cents, never a float. */
  balance_cents: number;
  /** the productivity-tool / not-claims-software disclaimer to render in-app. */
  disclaimer: string;
}

// ── custom-buildout setup status ──────────────────────────────────────────────
/** Whether the companion setup plugin has provisioned this install yet, and
 * whether the user dismissed the small first-run setup notice. The app never
 * blocks on this; it only shows or hides the notice banner. */
export interface SetupStatus {
  /** true once a valid Practice Profile exists in config. */
  profilePresent: boolean;
  /** true once the user dismissed the setup notice. */
  noticeDismissed: boolean;
}

// ── settings / secrets ────────────────────────────────────────────────────────
export interface ApiKeyStatus {
  present: boolean;
  encryptionAvailable: boolean;
}
export interface SetApiKeyReq {
  key: string;
}

// ── backup / restore (F6) ─────────────────────────────────────────────────────
export interface BackupExportReq {
  passphrase: string;
  destPath: string;
}
export interface BackupRestoreReq {
  passphrase: string;
  srcPath: string;
}
export interface BackupResult {
  ok: boolean;
  bytes?: number;
  code?: string;
  message?: string;
}

/** The shape the preload bridge exposes on window.api. The renderer programs
 * against this; it is the renderer-visible surface of the whole spine. */
export interface RendererApi {
  notes: {
    list(filter?: { client_id?: string; status?: string }): Promise<Note[]>;
    get(id: string): Promise<{ note: Note; addenda: NoteAddendum[] } | null>;
    createDraft(req: CreateDraftNoteReq): Promise<Note>;
    requestDraft(req: RequestDraftReq): Promise<Note>;
    saveSections(req: SaveSectionsReq): Promise<Note>;
    sign(req: SignNoteReq): Promise<Note>;
    addAddendum(req: AddAddendumReq): Promise<NoteAddendum>;
  };
  clients: {
    list(): Promise<Client[]>;
    get(id: string): Promise<Client | null>;
  };
  appointments: {
    list(): Promise<Appointment[]>;
  };
  intake: {
    fields(): Promise<IntakeFormSpec>;
    list(filter?: { client_id?: string }): Promise<IntakeRecord[]>;
    create(req: CreateIntakeReq): Promise<IntakeRecord>;
    recordsForClient(client_id: string): Promise<ClientRecords>;
    summarize(req: { intake_id: string }): Promise<{ summary: string }>;
    createPlan(req: CreatePlanReq): Promise<TreatmentPlan>;
    addGoal(req: AddGoalReq): Promise<TreatmentPlanGoal>;
  };
  scheduling: {
    list(): Promise<Appointment[]>;
    create(req: CreateAppointmentReq): Promise<Appointment>;
    reschedule(req: RescheduleAppointmentReq): Promise<Appointment>;
    cancel(req: CancelAppointmentReq): Promise<Appointment>;
    setStatus(req: SetAppointmentStatusReq): Promise<Appointment>;
    reminderTemplate(): Promise<{ template: string; leadHours: number }>;
    previewReminder(req: { appointment_id: string }): Promise<ReminderPreview>;
    stageReminder(req: { appointment_id: string }): Promise<StagedReminder>;
    outbox(): Promise<StagedReminder[]>;
    draftReminder(req: { appointment_id: string }): Promise<{ message: string }>;
  };
  billing: {
    listInvoices(): Promise<Invoice[]>;
    getInvoice(id: string): Promise<InvoiceDetail | null>;
    codeItems(filter?: { code_type?: string }): Promise<CodeItem[]>;
    providerProfile(): Promise<ProviderProfile | null>;
    generateInvoice(req: GenerateInvoiceReq): Promise<InvoiceDetail>;
    generateSuperbill(req: GenerateInvoiceReq): Promise<InvoiceDetail>;
    recordPayment(req: RecordPaymentReq): Promise<InvoiceDetail>;
    draftStatementSummary(req: { invoice_id: string }): Promise<{ summary: string }>;
  };
  app: {
    moduleRegistry(): Promise<ModuleDescriptor[]>;
    dataMode(): Promise<DataMode>;
    firstRunStatus(): Promise<{ acknowledged: boolean }>;
    firstRunAcknowledge(): Promise<void>;
    setupStatus(): Promise<SetupStatus>;
    setupDismissNotice(): Promise<void>;
  };
  config: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  settings: {
    apiKeyStatus(): Promise<ApiKeyStatus>;
    apiKeySet(req: SetApiKeyReq): Promise<void>;
    apiKeyClear(): Promise<void>;
  };
  backup: {
    export(req: BackupExportReq): Promise<BackupResult>;
    restore(req: BackupRestoreReq): Promise<BackupResult>;
  };
}
