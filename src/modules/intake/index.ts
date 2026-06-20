// intake module: FUNCTIONAL this wave (workflow 3 of 4). Client intake + records.
//
// Like the notes module, this file is THIN: each handler translates an IPC request
// into an IntakeService call. The service holds the config-driven mapping, the
// records read, and the guard-routed AI summary. The spine only iterates the
// registry; it never imports this file's internals.
//
// Config-driven form (hard rule 6): the intake fields are NOT hard-coded here. They
// come from config (intake.fields, seeded from DEFAULT_INTAKE_FIELDS). The
// 'intake:fields' handler returns the active list so the renderer's SchemaForm
// renders whatever config currently defines, with no rebuild.

import type { WorkflowModule } from '@shared/types/module.js';
import type { IpcRouter } from '@shared/types/ipc.js';
import type {
  CreateIntakeReq,
  CreatePlanReq,
  AddGoalReq,
  IntakeFormSpec,
} from '@shared/types/ipc.js';
import { CHANNELS } from '@shared/constants.js';
import type { IntakeService } from './intakeService.js';
import { DEFAULT_INTAKE_FIELDS } from './intakeFields.js';

export interface IntakeModuleDeps {
  service: IntakeService;
}

export function createIntakeModule(deps: IntakeModuleDeps): WorkflowModule {
  return {
    id: 'intake',
    title: 'Intake',
    icon: 'clipboard',
    functional: true,

    // The default field list is also published as defaultConfig so the user's
    // config.json overrides it (hard rule 6). The service reads the resolved list.
    defaultConfig: {
      intake: { fields: DEFAULT_INTAKE_FIELDS },
    },

    registerIpc(router: IpcRouter): void {
      router.handle(CHANNELS.intakeFields, (): IntakeFormSpec => ({
        fields: deps.service.formFields(),
      }));

      router.handle(CHANNELS.intakeList, (req: { client_id?: string } = {}) =>
        deps.service.list(req)
      );

      router.handle(CHANNELS.intakeCreate, (req: CreateIntakeReq) =>
        deps.service.createIntake({
          client_id: req.client_id,
          values: req.values,
          consent_acknowledged: req.consent_acknowledged,
        })
      );

      router.handle(CHANNELS.intakeRecordsForClient, (req: { client_id: string }) =>
        deps.service.recordsForClient(req.client_id)
      );

      router.handle(CHANNELS.intakeSummarize, (req: { intake_id: string }) =>
        deps.service.summarizeIntake(req.intake_id)
      );

      router.handle(CHANNELS.intakeCreatePlan, (req: CreatePlanReq) =>
        deps.service.createPlan(req.client_id, req.title)
      );

      router.handle(CHANNELS.intakeAddGoal, (req: AddGoalReq) =>
        deps.service.addGoal(req.treatment_plan_id, req.goal_text, req.target_date ?? null)
      );
    },
  };
}
