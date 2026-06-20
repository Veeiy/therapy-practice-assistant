// intakeService: the client-intake + records workflow (module A), matching the
// notes module's depth. It ties together:
//   * the config-driven intake form (intakeFields.ts) -> which fields are collected,
//   * the IntakeRepository (intake_record + treatment_plan + treatment_plan_goal),
//   * the AuditRepository (F4 action+IDs only),
//   * the EgressGuard + a ModelProvider-shaped summariser (Mock in this build) for
//     the AI "summarize intake" assist (purpose 'intake_summary').
//
// Config-driven core: createIntake() takes raw form `values` keyed by FormFieldDef
// key. It walks the ACTIVE field list (from config) and routes each value to its
// mapped intake_record column (if the field declares a known column) or into
// custom_fields_json (otherwise). Add a field in config -> it is collected and
// stored, with NO code change here. That is hard rule 6 made concrete.

import type {
  IntakeRecord,
  TreatmentPlan,
  TreatmentPlanGoal,
} from '@shared/types/domain.js';
import type { FormFieldDef } from '@shared/types/module.js';
import type { ClientRecords } from '@shared/types/ipc.js';
import type { DataMode } from '@shared/constants.js';
import type { IntakeRepository, CreateIntakeInput } from '@main/data/repositories/intakeRepository.js';
import type { AuditRepository } from '@main/data/repositories/auditRepository.js';
import type { EgressGuard } from '@main/agent/egressGuard.js';
import { stripDashes } from '@main/agent/textPostProcess.js';
import { KNOWN_INTAKE_COLUMNS, type IntakeFieldsResolver } from './intakeFields.js';

export interface IntakeServiceDeps {
  intake: IntakeRepository;
  audit: AuditRepository;
  guard: EgressGuard;
  dataMode: () => DataMode;
  /** the active intake field list (config-driven). Defaults to the built-ins but is
   * normally backed by the config store, so editing config re-shapes the form. */
  fields: IntakeFieldsResolver;
}

export interface CreateIntakeArgs {
  client_id: string;
  values: Record<string, unknown>;
  consent_acknowledged?: boolean;
  demo?: 0 | 1;
}

export class IntakeService {
  constructor(private readonly deps: IntakeServiceDeps) {}

  /** The active form spec, handed to the renderer so the SchemaForm renders whatever
   * config currently defines. */
  formFields(): FormFieldDef[] {
    return this.deps.fields();
  }

  /**
   * Create an intake record from a filled config-driven form. Routes each submitted
   * value to its mapped column or into custom_fields, per the ACTIVE field list.
   */
  createIntake(args: CreateIntakeArgs): IntakeRecord {
    const fields = this.deps.fields();
    const mapped: CreateIntakeInput = { client_id: args.client_id, demo: args.demo ?? 0 };
    const custom: Record<string, unknown> = {};

    for (const f of fields) {
      const raw = args.values[f.key];
      if (raw === undefined) continue;
      const column = f.column && KNOWN_INTAKE_COLUMNS.has(f.column) ? f.column : null;
      if (column === 'prior_therapy') mapped.prior_therapy = asText(raw);
      else if (column === 'hospitalizations') mapped.hospitalizations = asText(raw);
      else if (column === 'current_medications') mapped.current_medications = asText(raw);
      else if (column === 'substance_use') mapped.substance_use = asText(raw);
      else if (column === 'family_mh_history') mapped.family_mh_history = asText(raw);
      else if (column === 'consent_acknowledged') mapped.consent_acknowledged = Boolean(raw);
      else custom[f.key] = raw; // config-defined extra field -> flexible bag
    }

    // explicit consent flag wins if provided directly
    if (args.consent_acknowledged !== undefined) {
      mapped.consent_acknowledged = args.consent_acknowledged;
    }
    if (mapped.consent_acknowledged) {
      mapped.consent_acknowledged_date = new Date().toISOString().slice(0, 10);
    }
    if (Object.keys(custom).length) mapped.custom_fields = custom;

    const record = this.deps.intake.createIntake(mapped);
    // F4: record the action + IDs + a non-PHI field COUNT, never any field value.
    this.deps.audit.record(
      'intake_create',
      'intake_record',
      record.id,
      `fields=${fields.length} custom=${Object.keys(custom).length}`
    );
    return record;
  }

  /** Read a client's intake records + treatment plans (each with its goals) together
   * (the "records view" the brief asks for). */
  recordsForClient(clientId: string): ClientRecords {
    const intake = this.deps.intake.listIntake({ client_id: clientId });
    const plans = this.deps.intake.plansForClient(clientId).map((plan) => ({
      plan,
      goals: this.deps.intake.goalsForPlan(plan.id),
    }));
    return { intake, plans };
  }

  list(filter?: { client_id?: string }): IntakeRecord[] {
    return this.deps.intake.listIntake(filter);
  }

  createPlan(clientId: string, title: string, demo: 0 | 1 = 0): TreatmentPlan {
    const plan = this.deps.intake.createPlan(clientId, title, demo);
    this.deps.audit.record('treatment_plan_create', 'treatment_plan', plan.id, null);
    return plan;
  }

  addGoal(
    planId: string,
    goalText: string,
    targetDate: string | null = null,
    demo: 0 | 1 = 0
  ): TreatmentPlanGoal {
    const goal = this.deps.intake.addGoal(planId, goalText, targetDate, demo);
    this.deps.audit.record('treatment_plan_goal_add', 'treatment_plan_goal', goal.id, null);
    return goal;
  }

  /**
   * AI ASSIST (stub, Mock provider, through the guard, purpose 'intake_summary').
   * Builds a MINIMUM-NECESSARY, de-identified-leaning payload from an intake record
   * (only the free-text clinical fields, never the client's name / email / phone),
   * routes it through the SAME EgressGuard the notes workflow uses, and returns a
   * short narrative. In synthetic mode this is deterministic, offline, dash-free
   * (F5). It is NEVER sent to a real model in this build.
   */
  summarizeIntake(intakeId: string): { summary: string } {
    const record = this.deps.intake.getIntake(intakeId);
    if (!record) throw new Error('Intake record not found.');

    // Minimum-necessary payload: clinical free-text only, labeled generically. No
    // client identifiers are included; the guard redacts as a backstop anyway.
    const parts: string[] = [];
    if (record.prior_therapy) parts.push(`Prior therapy: ${record.prior_therapy}`);
    if (record.current_medications) parts.push(`Medications: ${record.current_medications}`);
    if (record.substance_use) parts.push(`Substance use: ${record.substance_use}`);
    if (record.family_mh_history) parts.push(`Family history: ${record.family_mh_history}`);
    if (record.hospitalizations) parts.push(`Hospitalizations: ${record.hospitalizations}`);

    const decision = this.deps.guard.guard({
      purpose: 'intake_summary',
      system:
        'Summarize an intake into a short, neutral clinical narrative of two to ' +
        'three sentences. Use only the information given. Do not invent facts. Do ' +
        'not include names, dates of birth, or contact details.',
      messages: [
        {
          role: 'user',
          content: `Summarize this intake into a brief narrative:\n${parts.join('\n')}`,
        },
      ],
      maxTokens: 400,
      mode: this.deps.dataMode(),
    });
    if (!decision.allowed) {
      const err = new Error(decision.reason ?? 'Egress not allowed.');
      (err as NodeJS.ErrnoException).code = decision.code;
      throw err;
    }

    // Deterministic synthetic draft (Mock provider equivalent): no network, no key,
    // no spend. Dash-free (F5). Reflects which sections were present without echoing
    // the raw text verbatim, keeping the output a SUMMARY rather than a copy.
    const present = [
      record.prior_therapy ? 'prior treatment history' : null,
      record.current_medications ? 'current medications' : null,
      record.substance_use ? 'substance use' : null,
      record.family_mh_history ? 'family mental health history' : null,
      record.hospitalizations ? 'prior hospitalizations' : null,
    ].filter((x): x is string => x !== null);

    const listed =
      present.length === 0
        ? 'limited background was provided at intake'
        : `the intake covers ${joinList(present)}`;

    const summary = stripDashes(
      `Intake summary (draft): ${capitalize(listed)}. ` +
        'Presenting concerns and goals should be confirmed with the client at the ' +
        'first session. This is an offline draft generated from synthetic data for ' +
        'review; edit before relying on it.'
    );

    // F4: log the action + a byte count from the guard meta, never the content.
    this.deps.audit.record(
      'intake_summary',
      'intake_record',
      record.id,
      `bytes=${decision.meta?.bytes ?? 0}`
    );
    return { summary };
  }
}

// ── small helpers ──
function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
