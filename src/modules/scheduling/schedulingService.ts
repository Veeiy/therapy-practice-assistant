// schedulingService: the scheduling + reminders workflow (module B), matching the
// notes module's depth. It ties together:
//   * the AppointmentsRepository (create / list / reschedule / cancel / setStatus),
//   * the RemindersRepository (the ONE canonical reminder model; outbox only),
//   * the reminderComposer (fills the F7 minimum-necessary template),
//   * the EgressGuard for the AI "draft reminder" assist (purpose 'reminder_draft').
//
// HARD TIER-1 CONSTRAINT: this service NEVER sends email or SMS. stageReminder()
// composes the exact text, schedules a send_at from the configured leadHours, and
// places a row in the OUTBOX with status 'scheduled'. previewReminder() returns the
// exact text WITHOUT writing anything. There is intentionally no send method. The
// real SMTP send is a documented operator go-live step. Email is the v1 channel; SMS
// is deferred (A2P 10DLC registration required; out of scope).

import type { Appointment, AppointmentStatus, Client } from '@shared/types/domain.js';
import type { ReminderPreview, StagedReminder } from '@shared/types/ipc.js';
import type { DataMode } from '@shared/constants.js';
import type { AppointmentsRepository } from '@main/data/repositories/appointmentsRepository.js';
import type { RemindersRepository } from '@main/data/repositories/remindersRepository.js';
import type { ClientsRepository } from '@main/data/repositories/clientsRepository.js';
import type { AuditRepository } from '@main/data/repositories/auditRepository.js';
import type { EgressGuard } from '@main/agent/egressGuard.js';
import { stripDashes } from '@main/agent/textPostProcess.js';
import { composeReminder } from './reminderComposer.js';

/** Config the scheduling service reads (F7 template + lead time + practice name).
 * Supplied as getters so a config edit takes effect without reconstructing the
 * service. */
export interface SchedulingConfig {
  reminderTemplate(): string;
  leadHours(): number;
  practiceName(): string;
}

export interface SchedulingServiceDeps {
  appointments: AppointmentsRepository;
  reminders: RemindersRepository;
  clients: ClientsRepository;
  audit: AuditRepository;
  guard: EgressGuard;
  dataMode: () => DataMode;
  config: SchedulingConfig;
}

export interface CreateAppointmentArgs {
  client_id: string;
  starts_at: string;
  duration_minutes?: number;
  modality?: 'in_person' | 'telehealth';
  service_type?: string | null;
  demo?: 0 | 1;
}

export class SchedulingService {
  constructor(private readonly deps: SchedulingServiceDeps) {}

  // ── appointment CRUD ──
  list(): Appointment[] {
    return this.deps.appointments.list();
  }

  create(args: CreateAppointmentArgs): Appointment {
    const appt = this.deps.appointments.create({
      client_id: args.client_id,
      starts_at: args.starts_at,
      duration_minutes: args.duration_minutes,
      modality: args.modality,
      service_type: args.service_type ?? null,
      status: 'scheduled',
      demo: args.demo ?? 0,
    });
    this.deps.audit.record('appointment_create', 'appointment', appt.id, null);
    return appt;
  }

  reschedule(id: string, startsAt: string, durationMinutes?: number): Appointment {
    const appt = this.deps.appointments.reschedule(id, startsAt, durationMinutes);
    this.deps.audit.record('appointment_reschedule', 'appointment', id, null);
    return appt;
  }

  cancel(id: string, by: 'client' | 'clinician'): Appointment {
    const appt = this.deps.appointments.cancel(id, by);
    this.deps.audit.record('appointment_cancel', 'appointment', id, `by=${by}`);
    return appt;
  }

  setStatus(id: string, status: AppointmentStatus): Appointment {
    const appt = this.deps.appointments.setStatus(id, status);
    this.deps.audit.record('appointment_status', 'appointment', id, `status=${status}`);
    return appt;
  }

  // ── reminders (staged, never sent) ──
  /** The F7 operator-editable template + lead time, surfaced for the Settings UI. */
  reminderTemplate(): { template: string; leadHours: number } {
    return { template: this.deps.config.reminderTemplate(), leadHours: this.deps.config.leadHours() };
  }

  /** Compute the scheduled send time = appointment start minus leadHours. */
  private sendAtFor(appt: Appointment): string {
    const start = new Date(appt.starts_at).getTime();
    const lead = this.deps.config.leadHours() * 60 * 60 * 1000;
    return new Date(start - lead).toISOString();
  }

  private appointmentOrThrow(id: string): Appointment {
    const appt = this.deps.appointments.get(id);
    if (!appt) throw new Error('Appointment not found.');
    return appt;
  }

  private clientFor(appt: Appointment): Client | null {
    return this.deps.clients.get(appt.client_id);
  }

  /**
   * PREVIEW the exact reminder text that WOULD be sent. Writes nothing. This is the
   * "visible preview of the exact text" the brief requires.
   */
  previewReminder(appointmentId: string): ReminderPreview {
    const appt = this.appointmentOrThrow(appointmentId);
    const client = this.clientFor(appt);
    const preview = composeReminder(appt, client, {
      template: this.deps.config.reminderTemplate(),
      practiceName: this.deps.config.practiceName(),
    });
    preview.send_at = this.sendAtFor(appt);
    return preview;
  }

  /**
   * STAGE a reminder into the OUTBOX: compose + schedule + queue. status='scheduled'.
   * NOTHING is sent. Returns the staged row joined with its exact preview text so the
   * UI can show what is queued. The real send is an operator go-live step.
   */
  stageReminder(appointmentId: string): StagedReminder {
    const appt = this.appointmentOrThrow(appointmentId);
    const preview = this.previewReminder(appointmentId);
    const row = this.deps.reminders.stage({
      appointment_id: appt.id,
      send_at: preview.send_at,
      template_id: 'default_email',
      demo: appt.demo,
    });
    // F4: action + IDs only. We log that a reminder was QUEUED, never its text.
    this.deps.audit.record('reminder_staged', 'reminder', row.id, `appt=${appt.id}`);
    return {
      id: row.id,
      appointment_id: row.appointment_id,
      channel: 'email',
      send_at: row.send_at,
      status: row.status,
      preview,
    };
  }

  /** The OUTBOX: every staged reminder with its current preview text. None sent. */
  outbox(): StagedReminder[] {
    return this.deps.reminders.outbox().map((row) => {
      const appt = this.deps.appointments.get(row.appointment_id);
      const client = appt ? this.clientFor(appt) : null;
      const preview = appt
        ? {
            ...composeReminder(appt, client, {
              template: this.deps.config.reminderTemplate(),
              practiceName: this.deps.config.practiceName(),
            }),
            send_at: row.send_at,
          }
        : emptyPreview(row.appointment_id, row.send_at);
      return {
        id: row.id,
        appointment_id: row.appointment_id,
        channel: 'email' as const,
        send_at: row.send_at,
        status: row.status,
        preview,
      };
    });
  }

  /**
   * AI ASSIST (stub, through the guard, purpose 'reminder_draft'). This is a generic
   * tone helper that returns an alternative phrasing for the bland default. It runs
   * through the SAME EgressGuard, in synthetic mode, offline (no key, no network, no
   * spend), and is dash-free (F5). It does NOT send and does NOT include client
   * identifiers in the request (minimum-necessary: only a neutral instruction).
   */
  draftReminder(appointmentId: string): { message: string } {
    // confirm the appointment exists (so the UI cannot draft for a missing id)
    this.appointmentOrThrow(appointmentId);
    const decision = this.deps.guard.guard({
      purpose: 'reminder_draft',
      system:
        'Write a short, warm, neutral appointment reminder. Confirm that an ' +
        'appointment is upcoming and invite the person to reply to reschedule. Do ' +
        'not include any names, dates, diagnoses, or clinical detail.',
      messages: [
        { role: 'user', content: 'Draft a brief, friendly appointment reminder message.' },
      ],
      maxTokens: 300,
      mode: this.deps.dataMode(),
    });
    if (!decision.allowed) {
      const err = new Error(decision.reason ?? 'Egress not allowed.');
      (err as NodeJS.ErrnoException).code = decision.code;
      throw err;
    }
    const message = stripDashes(
      'This is a friendly reminder of your upcoming appointment. Please reply to ' +
        'this email if you need to reschedule or have any questions. We look forward ' +
        'to seeing you.'
    );
    this.deps.audit.record('reminder_draft', 'appointment', appointmentId, `bytes=${decision.meta?.bytes ?? 0}`);
    return { message };
  }
}

function emptyPreview(appointmentId: string, sendAt: string): ReminderPreview {
  return {
    appointment_id: appointmentId,
    channel: 'email',
    to: null,
    send_at: sendAt,
    subject: '',
    body: '',
    warnings: ['Appointment no longer exists.'],
  };
}
