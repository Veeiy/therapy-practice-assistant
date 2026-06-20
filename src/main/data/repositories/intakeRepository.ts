// intakeRepository: the ONLY code that writes intake_record / treatment_plan /
// treatment_plan_goal SQL. It mirrors clientsRepository's shape: Clock/IdGen
// injection for deterministic tests, JSON helpers for the *_json columns, row -> type
// mappers, and parameterized statements.
//
// The intake_record schema (0001_init.sql) is NOT redesigned here (binding F3). The
// config-driven intake form decides which fields are collected; the service maps
// known field keys onto the columns below and everything else into
// custom_fields_json. This repo just persists and reads what it is handed.

import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import type {
  IntakeRecord,
  InsuranceInfo,
  TreatmentPlan,
  TreatmentPlanStatus,
  TreatmentPlanGoal,
  GoalStatus,
} from '@shared/types/domain.js';
import { type Clock, type IdGen, parseJson, toJson, boolToInt, intToBool } from './support.js';

interface IntakeRow {
  id: string;
  client_id: string;
  prior_therapy: string | null;
  hospitalizations: string | null;
  current_medications: string | null;
  substance_use: string | null;
  family_mh_history: string | null;
  insurance_json: string | null;
  consent_acknowledged: number;
  consent_acknowledged_date: string | null;
  custom_fields_json: string;
  demo: number;
  created_at: string;
  updated_at: string;
}

function rowToIntake(r: IntakeRow): IntakeRecord {
  return {
    id: r.id,
    client_id: r.client_id,
    prior_therapy: r.prior_therapy,
    hospitalizations: r.hospitalizations,
    current_medications: r.current_medications,
    substance_use: r.substance_use,
    family_mh_history: r.family_mh_history,
    insurance: parseJson<InsuranceInfo | null>(r.insurance_json, null),
    consent_acknowledged: intToBool(r.consent_acknowledged),
    consent_acknowledged_date: r.consent_acknowledged_date,
    custom_fields: parseJson<Record<string, unknown>>(r.custom_fields_json, {}),
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

interface PlanRow {
  id: string;
  client_id: string;
  title: string;
  status: TreatmentPlanStatus;
  demo: number;
  created_at: string;
  updated_at: string;
}
function rowToPlan(r: PlanRow): TreatmentPlan {
  return {
    id: r.id,
    client_id: r.client_id,
    title: r.title,
    status: r.status,
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

interface GoalRow {
  id: string;
  treatment_plan_id: string;
  goal_text: string;
  target_date: string | null;
  status: GoalStatus;
  demo: number;
  created_at: string;
  updated_at: string;
}
function rowToGoal(r: GoalRow): TreatmentPlanGoal {
  return {
    id: r.id,
    treatment_plan_id: r.treatment_plan_id,
    goal_text: r.goal_text,
    target_date: r.target_date,
    status: r.status,
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** What the service hands the repo to write an intake. Known columns are explicit;
 * anything config-defined that does not map to a column goes in custom_fields. */
export interface CreateIntakeInput {
  client_id: string;
  prior_therapy?: string | null;
  hospitalizations?: string | null;
  current_medications?: string | null;
  substance_use?: string | null;
  family_mh_history?: string | null;
  insurance?: InsuranceInfo | null;
  consent_acknowledged?: boolean;
  consent_acknowledged_date?: string | null;
  custom_fields?: Record<string, unknown>;
  demo?: 0 | 1;
}

export class IntakeRepository {
  constructor(
    private readonly db: DB,
    private readonly clock: Clock,
    private readonly ids: IdGen
  ) {}

  // ── intake_record ──
  createIntake(input: CreateIntakeInput): IntakeRecord {
    const now = this.clock.nowIso();
    const id = this.ids.next();
    this.db
      .prepare(
        `INSERT INTO intake_record
          (id, client_id, prior_therapy, hospitalizations, current_medications,
           substance_use, family_mh_history, insurance_json, consent_acknowledged,
           consent_acknowledged_date, custom_fields_json, demo, created_at, updated_at)
         VALUES
          (@id, @client_id, @prior_therapy, @hospitalizations, @current_medications,
           @substance_use, @family_mh_history, @insurance_json, @consent,
           @consent_date, @custom_fields_json, @demo, @now, @now)`
      )
      .run({
        id,
        client_id: input.client_id,
        prior_therapy: input.prior_therapy ?? null,
        hospitalizations: input.hospitalizations ?? null,
        current_medications: input.current_medications ?? null,
        substance_use: input.substance_use ?? null,
        family_mh_history: input.family_mh_history ?? null,
        insurance_json: toJson(input.insurance ?? null),
        consent: boolToInt(input.consent_acknowledged ?? false),
        consent_date: input.consent_acknowledged_date ?? null,
        custom_fields_json: toJson(input.custom_fields ?? {}) ?? '{}',
        demo: input.demo ?? 0,
        now,
      });
    return this.getIntake(id)!;
  }

  getIntake(id: string): IntakeRecord | null {
    const r = this.db.prepare('SELECT * FROM intake_record WHERE id = ?').get(id) as
      | IntakeRow
      | undefined;
    return r ? rowToIntake(r) : null;
  }

  listIntake(filter?: { client_id?: string }): IntakeRecord[] {
    const rows = (
      filter?.client_id
        ? this.db
            .prepare('SELECT * FROM intake_record WHERE client_id = ? ORDER BY created_at DESC')
            .all(filter.client_id)
        : this.db.prepare('SELECT * FROM intake_record ORDER BY created_at DESC').all()
    ) as IntakeRow[];
    return rows.map(rowToIntake);
  }

  // ── treatment_plan ──
  createPlan(clientId: string, title: string, demo: 0 | 1 = 0): TreatmentPlan {
    const now = this.clock.nowIso();
    const id = this.ids.next();
    this.db
      .prepare(
        `INSERT INTO treatment_plan (id, client_id, title, status, demo, created_at, updated_at)
         VALUES (@id, @client_id, @title, 'active', @demo, @now, @now)`
      )
      .run({ id, client_id: clientId, title, demo, now });
    return this.getPlan(id)!;
  }

  getPlan(id: string): TreatmentPlan | null {
    const r = this.db.prepare('SELECT * FROM treatment_plan WHERE id = ?').get(id) as
      | PlanRow
      | undefined;
    return r ? rowToPlan(r) : null;
  }

  plansForClient(clientId: string): TreatmentPlan[] {
    const rows = this.db
      .prepare('SELECT * FROM treatment_plan WHERE client_id = ? ORDER BY created_at DESC')
      .all(clientId) as PlanRow[];
    return rows.map(rowToPlan);
  }

  // ── treatment_plan_goal ──
  addGoal(
    planId: string,
    goalText: string,
    targetDate: string | null = null,
    demo: 0 | 1 = 0
  ): TreatmentPlanGoal {
    const now = this.clock.nowIso();
    const id = this.ids.next();
    this.db
      .prepare(
        `INSERT INTO treatment_plan_goal
          (id, treatment_plan_id, goal_text, target_date, status, demo, created_at, updated_at)
         VALUES (@id, @plan_id, @goal_text, @target_date, 'not_started', @demo, @now, @now)`
      )
      .run({ id, plan_id: planId, goal_text: goalText, target_date: targetDate, demo, now });
    const r = this.db.prepare('SELECT * FROM treatment_plan_goal WHERE id = ?').get(id) as GoalRow;
    return rowToGoal(r);
  }

  goalsForPlan(planId: string): TreatmentPlanGoal[] {
    const rows = this.db
      .prepare('SELECT * FROM treatment_plan_goal WHERE treatment_plan_id = ? ORDER BY created_at ASC')
      .all(planId) as GoalRow[];
    return rows.map(rowToGoal);
  }
}
