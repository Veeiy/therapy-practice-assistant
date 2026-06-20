// THE MODULE REGISTRY. Adding a workflow to the app is: create its directory under
// src/modules/, then add ONE line to the array this file returns. The spine calls
// buildModules() with the shared dependencies, hands the result to the ModuleHost,
// and the rest (config merge, IPC registration, nav rail) happens automatically.
//
// This is the literal expression of the brief's architecture: "a module is a
// directory plus one line in src/modules/index.ts."
//
// Wave 3: all four workflows are now FUNCTIONAL. Each is constructed the same way:
// build its service from the shared repositories + the egress guard + a config
// accessor, then hand the service to the module factory. The factories stay thin;
// the services hold the workflow logic and the safety boundaries.
//
// CONFIG ACCESS IS LATE-BOUND. The composition root (main/index.ts) builds the
// ConfigStore AFTER buildModules(), because the config defaults are themselves
// assembled from each module's defaultConfig. So we take a getConfig() accessor that
// returns the store once it exists (null before then), exactly like dataMode(). The
// service config getters read through it at CALL time, by which point boot is done.
// Each getter falls back to the same baked-in default the config layer seeds, so a
// read that somehow lands before assignment is still correct, never undefined.

import type { WorkflowModule } from '@shared/types/module.js';
import type { FormFieldDef } from '@shared/types/module.js';
import type { DataStore } from '@main/data/dataStore.js';
import type { AgentRuntime } from '@main/agent/runtime.js';
import type { ConfigStore } from '@main/config/configStore.js';
import type { DataMode } from '@shared/constants.js';

import { NoteService } from './notes/noteService.js';
import { createNotesModule } from './notes/index.js';

import { IntakeService } from './intake/intakeService.js';
import { createIntakeModule } from './intake/index.js';
import { DEFAULT_INTAKE_FIELDS } from './intake/intakeFields.js';

import { SchedulingService } from './scheduling/schedulingService.js';
import { createSchedulingModule } from './scheduling/index.js';

import { BillingService } from './billing/billingService.js';
import { createBillingModule } from './billing/index.js';

export interface BuildModulesDeps {
  store: DataStore;
  runtime: AgentRuntime;
  dataMode: () => DataMode;
  /** Late-bound config accessor. Returns the store once the composition root has
   * built it (null beforehand). Module services read config through this at call
   * time, never at construction time. */
  getConfig: () => ConfigStore | null;
}

export function buildModules(deps: BuildModulesDeps): WorkflowModule[] {
  const guard = deps.runtime.egressGuard();
  const cfg = deps.getConfig;

  // ── notes (workflow 1): the original functional workflow ──
  const noteService = new NoteService({
    notes: deps.store.notes,
    audit: deps.store.audit,
    provider: deps.runtime.provider(),
    dataMode: deps.dataMode(),
  });

  // ── intake (workflow 2): config-driven form + records + AI summary ──
  // The active field list is read from config (intake.fields), falling back to the
  // built-in defaults. Editing config re-shapes the form with no code change.
  const intakeService = new IntakeService({
    intake: deps.store.intake,
    audit: deps.store.audit,
    guard,
    dataMode: deps.dataMode,
    fields: (): FormFieldDef[] =>
      cfg()?.get<FormFieldDef[]>('intake.fields') ?? DEFAULT_INTAKE_FIELDS,
  });

  // ── scheduling (workflow 3): appointment CRUD + staged (never sent) reminders ──
  // The F7 template, lead time, and practice name all come from config so the
  // operator can edit the reminder wording and timing from Settings without a build.
  const schedulingService = new SchedulingService({
    appointments: deps.store.appointments,
    reminders: deps.store.reminders,
    clients: deps.store.clients,
    audit: deps.store.audit,
    guard,
    dataMode: deps.dataMode,
    config: {
      reminderTemplate: () =>
        cfg()?.get<string>('reminders.defaultTemplate') ?? DEFAULT_REMINDER_TEMPLATE,
      leadHours: () => cfg()?.get<number>('reminders.leadHours') ?? 24,
      practiceName: () => cfg()?.get<string>('app.productName') ?? 'Therapy Practice Assistant',
    },
  });

  // ── billing (workflow 4): invoices + superbills (generate only, never submit) ──
  const billingService = new BillingService({
    billing: deps.store.billing,
    audit: deps.store.audit,
    guard,
    dataMode: deps.dataMode,
  });

  return [
    createNotesModule({ service: noteService }),
    createIntakeModule({ service: intakeService }),
    createSchedulingModule({ service: schedulingService }),
    createBillingModule({ service: billingService }),
  ];
}

/** Fallback reminder template, identical to the one seeded in APP_DEFAULT_CONFIG.
 * Used only if a config read somehow precedes the store being assigned; the real
 * source of truth for operator edits is reminders.defaultTemplate in config. */
const DEFAULT_REMINDER_TEMPLATE =
  'Hello {{preferred_name}}, this is a reminder of your appointment on ' +
  '{{date}} at {{time}}. Reply to this email if you need to reschedule. ' +
  'Thank you.';
