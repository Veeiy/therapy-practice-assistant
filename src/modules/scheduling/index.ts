// scheduling module: FUNCTIONAL this wave (workflow 2 of 4). Scheduling + reminders.
//
// Thin handlers over the SchedulingService. The service owns appointment CRUD, the
// ONE canonical reminder model, the F7 minimum-necessary template fill, the OUTBOX
// staging (compose + schedule + queue, NEVER send), and the guard-routed AI
// reminder-draft stub.
//
// HARD TIER-1 CONSTRAINT (carried in the handler names): there is a stageReminder
// and a previewReminder, but NO sendReminder. Sending is an external side effect the
// safety floor forbids in this run; it is an operator go-live step (real SMTP).

import type { WorkflowModule } from '@shared/types/module.js';
import type { IpcRouter } from '@shared/types/ipc.js';
import type {
  CreateAppointmentReq,
  RescheduleAppointmentReq,
  CancelAppointmentReq,
  SetAppointmentStatusReq,
} from '@shared/types/ipc.js';
import { CHANNELS } from '@shared/constants.js';
import type { SchedulingService } from './schedulingService.js';

export interface SchedulingModuleDeps {
  service: SchedulingService;
}

export function createSchedulingModule(deps: SchedulingModuleDeps): WorkflowModule {
  return {
    id: 'scheduling',
    title: 'Scheduling',
    icon: 'calendar',
    functional: true,

    defaultConfig: {
      // Consumed via the service's SchedulingConfig getters (custom buildout);
      // the setup plugin overrides both from the interview. The modality seed is
      // 'telehealth' because that is the initial state the schedule form has
      // always shown, so an un-provisioned install behaves exactly as before.
      scheduling: { defaultDurationMinutes: 50, defaultModality: 'telehealth' },
    },

    registerIpc(router: IpcRouter): void {
      router.handle(CHANNELS.schedulingList, () => deps.service.list());

      router.handle(CHANNELS.schedulingCreate, (req: CreateAppointmentReq) =>
        deps.service.create({
          client_id: req.client_id,
          starts_at: req.starts_at,
          duration_minutes: req.duration_minutes,
          modality: req.modality,
          service_type: req.service_type ?? null,
        })
      );

      router.handle(CHANNELS.schedulingReschedule, (req: RescheduleAppointmentReq) =>
        deps.service.reschedule(req.id, req.starts_at, req.duration_minutes)
      );

      router.handle(CHANNELS.schedulingCancel, (req: CancelAppointmentReq) =>
        deps.service.cancel(req.id, req.by)
      );

      router.handle(CHANNELS.schedulingSetStatus, (req: SetAppointmentStatusReq) =>
        deps.service.setStatus(req.id, req.status)
      );

      // ── reminders: preview + stage (NEVER send) + outbox ──
      router.handle(CHANNELS.schedulingReminderTemplate, () => deps.service.reminderTemplate());

      router.handle(CHANNELS.schedulingPreviewReminder, (req: { appointment_id: string }) =>
        deps.service.previewReminder(req.appointment_id)
      );

      router.handle(CHANNELS.schedulingStageReminder, (req: { appointment_id: string }) =>
        deps.service.stageReminder(req.appointment_id)
      );

      router.handle(CHANNELS.schedulingOutbox, () => deps.service.outbox());

      // AI stub (purpose 'reminder_draft'), guard-routed, offline, dash-free.
      router.handle(CHANNELS.schedulingDraftReminder, (req: { appointment_id: string }) =>
        deps.service.draftReminder(req.appointment_id)
      );
    },
  };
}
