// preload/index.ts: the ONLY bridge between the sandboxed renderer and the main
// process. With contextIsolation on, the renderer cannot require Node, reach the
// DB, or import the SDK. It can only call the whitelisted functions exposed here on
// window.api, each of which is a typed wrapper over a single ipcRenderer.invoke.
//
// Two hardening details:
//   * Every channel is an explicit, named invoke. There is no generic passthrough,
//     so the renderer cannot call an arbitrary channel.
//   * Main-process handlers return a SerializedIpcError object instead of throwing
//     across the boundary. unwrap() rethrows it as a real Error on the renderer
//     side, carrying the stable .code so UI can branch (e.g. NOTE_IMMUTABLE) without
//     parsing the message text.

import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/constants.js';
import type { RendererApi } from '../shared/types/ipc.js';

interface SerializedIpcError {
  __ipcError: true;
  code?: string;
  message: string;
}
function isIpcError(v: unknown): v is SerializedIpcError {
  return !!v && typeof v === 'object' && (v as { __ipcError?: unknown }).__ipcError === true;
}

/** Invoke a channel and rethrow a serialized main-process error as a real Error. */
async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const res = await ipcRenderer.invoke(channel, payload);
  if (isIpcError(res)) {
    const err = new Error(res.message);
    if (res.code) (err as { code?: string }).code = res.code;
    throw err;
  }
  return res as T;
}

const api: RendererApi = {
  notes: {
    list: (filter) => call(CHANNELS.notesList, filter ?? {}),
    get: (id) => call(CHANNELS.notesGet, { id }),
    createDraft: (req) => call(CHANNELS.notesCreateDraft, req),
    requestDraft: (req) => call(CHANNELS.notesRequestDraft, req),
    saveSections: (req) => call(CHANNELS.notesSaveSections, req),
    sign: (req) => call(CHANNELS.notesSign, req),
    addAddendum: (req) => call(CHANNELS.notesAddAddendum, req),
  },
  clients: {
    list: () => call(CHANNELS.clientsList),
    get: (id) => call(CHANNELS.clientsGet, { id }),
  },
  appointments: {
    list: () => call(CHANNELS.appointmentsList),
  },
  intake: {
    fields: () => call(CHANNELS.intakeFields),
    list: (filter) => call(CHANNELS.intakeList, filter ?? {}),
    create: (req) => call(CHANNELS.intakeCreate, req),
    recordsForClient: (client_id) => call(CHANNELS.intakeRecordsForClient, { client_id }),
    summarize: (req) => call(CHANNELS.intakeSummarize, req),
    createPlan: (req) => call(CHANNELS.intakeCreatePlan, req),
    addGoal: (req) => call(CHANNELS.intakeAddGoal, req),
  },
  scheduling: {
    list: () => call(CHANNELS.schedulingList),
    create: (req) => call(CHANNELS.schedulingCreate, req),
    reschedule: (req) => call(CHANNELS.schedulingReschedule, req),
    cancel: (req) => call(CHANNELS.schedulingCancel, req),
    setStatus: (req) => call(CHANNELS.schedulingSetStatus, req),
    reminderTemplate: () => call(CHANNELS.schedulingReminderTemplate),
    previewReminder: (req) => call(CHANNELS.schedulingPreviewReminder, req),
    stageReminder: (req) => call(CHANNELS.schedulingStageReminder, req),
    outbox: () => call(CHANNELS.schedulingOutbox),
    draftReminder: (req) => call(CHANNELS.schedulingDraftReminder, req),
  },
  billing: {
    listInvoices: () => call(CHANNELS.billingListInvoices),
    getInvoice: (id) => call(CHANNELS.billingGetInvoice, { id }),
    codeItems: (filter) => call(CHANNELS.billingCodeItems, filter ?? {}),
    providerProfile: () => call(CHANNELS.billingProviderProfile),
    generateInvoice: (req) => call(CHANNELS.billingGenerateInvoice, req),
    generateSuperbill: (req) => call(CHANNELS.billingGenerateSuperbill, req),
    recordPayment: (req) => call(CHANNELS.billingRecordPayment, req),
    draftStatementSummary: (req) => call(CHANNELS.billingDraftStatementSummary, req),
  },
  app: {
    moduleRegistry: () => call(CHANNELS.moduleRegistry),
    dataMode: () => call(CHANNELS.dataModeGet),
    firstRunStatus: () => call(CHANNELS.firstRunStatus),
    firstRunAcknowledge: () => call(CHANNELS.firstRunAcknowledge),
  },
  config: {
    get: (key) => call(CHANNELS.configGet, { key }),
    set: (key, value) => call(CHANNELS.configSet, { key, value }),
  },
  settings: {
    apiKeyStatus: () => call(CHANNELS.apiKeyStatus),
    apiKeySet: (req) => call(CHANNELS.apiKeySet, req),
    apiKeyClear: () => call(CHANNELS.apiKeyClear),
  },
  backup: {
    export: (req) => call(CHANNELS.backupExport, req),
    restore: (req) => call(CHANNELS.backupRestore, req),
  },
};

// Expose the single, frozen api object. contextBridge deep-clones across the
// isolation boundary, so the renderer gets a safe copy with no Node references.
contextBridge.exposeInMainWorld('api', api);
