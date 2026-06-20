// Shared constants imported by BOTH main and renderer.
// No PHI, no secrets, no logic. Just names and enums that both sides agree on.

/**
 * F1 / safety floor: the master compile/config gate for sending REAL client PHI
 * to the Anthropic cloud API. It is FALSE in this build and the EgressGuard
 * refuses every real-mode request while it is false. Flipping this to true is an
 * operator go-live step that happens ONLY after a signed Anthropic BAA on a
 * HIPAA-enabled org. It is never a developer convenience toggle.
 */
export const FEATURE_REAL_PHI_EGRESS = false as const;

/**
 * The model the SDK is pinned to (F1: pin the model explicitly). The operator
 * confirms the exact go-live model at BAA setup; until then this is the default
 * the runtime pins so nothing floats to an unintended model. Synthetic-only in
 * this build, so no real call is ever made against it here.
 */
export const PINNED_MODEL = 'claude-3-5-sonnet-latest';

/** Data mode: synthetic demo data vs the therapist's real clients. */
export type DataMode = 'synthetic' | 'real';

/** IPC channel names. One namespace per concern. Renderer only ever sees these. */
export const CHANNELS = {
  // notes workflow
  notesList: 'notes:list',
  notesGet: 'notes:get',
  notesCreateDraft: 'notes:createDraft',
  notesRequestDraft: 'notes:requestDraft',
  notesSaveSections: 'notes:saveSections',
  notesSign: 'notes:sign',
  notesAddAddendum: 'notes:addAddendum',
  // clients
  clientsList: 'clients:list',
  clientsGet: 'clients:get',
  // appointments
  appointmentsList: 'appointments:list',
  // ── intake workflow (Wave 3, module A) ──
  intakeFields: 'intake:fields', // the config-driven form field definitions
  intakeList: 'intake:list',
  intakeCreate: 'intake:create',
  intakeRecordsForClient: 'intake:recordsForClient', // intake + plan + goals together
  intakeSummarize: 'intake:summarize', // AI stub, purpose 'intake_summary'
  intakeCreatePlan: 'intake:createPlan',
  intakeAddGoal: 'intake:addGoal',
  // ── scheduling workflow (Wave 3, module B) ──
  schedulingList: 'scheduling:list',
  schedulingCreate: 'scheduling:create',
  schedulingReschedule: 'scheduling:reschedule',
  schedulingCancel: 'scheduling:cancel',
  schedulingSetStatus: 'scheduling:setStatus',
  schedulingReminderTemplate: 'scheduling:reminderTemplate', // F7 minimum-necessary template
  schedulingPreviewReminder: 'scheduling:previewReminder', // exact text that WOULD send
  schedulingStageReminder: 'scheduling:stageReminder', // compose + queue into OUTBOX (no send)
  schedulingOutbox: 'scheduling:outbox', // the staged, never-sent reminders
  schedulingDraftReminder: 'scheduling:draftReminder', // AI stub, purpose 'reminder_draft'
  // ── billing workflow (Wave 3, module C) ──
  billingListInvoices: 'billing:listInvoices',
  billingGetInvoice: 'billing:getInvoice', // invoice + service lines + payments + balance
  billingCodeItems: 'billing:codeItems',
  billingProviderProfile: 'billing:providerProfile',
  billingGenerateInvoice: 'billing:generateInvoice',
  billingGenerateSuperbill: 'billing:generateSuperbill',
  billingRecordPayment: 'billing:recordPayment',
  billingDraftStatementSummary: 'billing:draftStatementSummary', // AI stub, purpose 'statement_summary'
  // config / shell
  configGet: 'config:get',
  configSet: 'config:set',
  moduleRegistry: 'app:moduleRegistry',
  dataModeGet: 'app:dataModeGet',
  // settings / secrets
  apiKeyStatus: 'settings:apiKeyStatus',
  apiKeySet: 'settings:apiKeySet',
  apiKeyClear: 'settings:apiKeyClear',
  // backup / restore (F6)
  backupExport: 'backup:export',
  backupRestore: 'backup:restore',
  // first run
  firstRunStatus: 'firstRun:status',
  firstRunAcknowledge: 'firstRun:acknowledge',
} as const;

/** Stable error codes the renderer can branch on without parsing prose. */
export const ERROR_CODES = {
  EGRESS_BLOCKED_REAL: 'EGRESS_BLOCKED_REAL',
  EGRESS_NON_MESSAGES: 'EGRESS_NON_MESSAGES',
  EGRESS_SCHEMA_VALUES: 'EGRESS_SCHEMA_VALUES',
  NOTE_IMMUTABLE: 'NOTE_IMMUTABLE',
  NO_API_KEY: 'NO_API_KEY',
  ENCRYPTION_UNAVAILABLE: 'ENCRYPTION_UNAVAILABLE',
  BACKUP_BAD_PASSPHRASE: 'BACKUP_BAD_PASSPHRASE',
  BACKUP_BAD_FORMAT: 'BACKUP_BAD_FORMAT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
