// appointmentsRepository: the only code that writes appointment SQL.
// Scheduling's full UI is next wave; this repo plus the schema make the data real
// now (F3 scaffold-is-real-data).

import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import type {
  Appointment,
  Modality,
  AppointmentStatus,
  AppointmentReminderStatus,
} from '@shared/types/domain.js';
import { type Clock, type IdGen, parseJson, boolToInt, intToBool } from './support.js';

interface AppointmentRow {
  id: string;
  client_id: string;
  starts_at: string;
  duration_minutes: number;
  modality: Modality;
  location: string | null;
  telehealth_link: string | null;
  service_type: string | null;
  status: AppointmentStatus;
  recurrence_rule: string | null;
  fee_flag: number;
  reminder_status: AppointmentReminderStatus;
  custom_fields_json: string;
  demo: number;
  created_at: string;
  updated_at: string;
}

function rowToAppt(r: AppointmentRow): Appointment {
  return {
    id: r.id,
    client_id: r.client_id,
    starts_at: r.starts_at,
    duration_minutes: r.duration_minutes,
    modality: r.modality,
    location: r.location,
    telehealth_link: r.telehealth_link,
    service_type: r.service_type,
    status: r.status,
    recurrence_rule: r.recurrence_rule,
    fee_flag: intToBool(r.fee_flag),
    reminder_status: r.reminder_status,
    custom_fields: parseJson<Record<string, unknown>>(r.custom_fields_json, {}),
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface CreateAppointmentInput {
  client_id: string;
  starts_at: string;
  duration_minutes?: number;
  modality?: Modality;
  location?: string | null;
  service_type?: string | null;
  status?: AppointmentStatus;
  demo?: 0 | 1;
}

export class AppointmentsRepository {
  constructor(
    private readonly db: DB,
    private readonly clock: Clock,
    private readonly ids: IdGen
  ) {}

  create(input: CreateAppointmentInput): Appointment {
    const now = this.clock.nowIso();
    const id = this.ids.next();
    this.db
      .prepare(
        `INSERT INTO appointment
          (id, client_id, starts_at, duration_minutes, modality, location,
           service_type, status, fee_flag, reminder_status, custom_fields_json,
           demo, created_at, updated_at)
         VALUES
          (@id, @client_id, @starts_at, @duration, @modality, @location,
           @service_type, @status, 0, 'none', '{}', @demo, @now, @now)`
      )
      .run({
        id,
        client_id: input.client_id,
        starts_at: input.starts_at,
        duration: input.duration_minutes ?? 50,
        modality: input.modality ?? 'in_person',
        location: input.location ?? null,
        service_type: input.service_type ?? null,
        status: input.status ?? 'scheduled',
        demo: input.demo ?? 0,
        now,
      });
    return this.get(id)!;
  }

  get(id: string): Appointment | null {
    const r = this.db.prepare('SELECT * FROM appointment WHERE id = ?').get(id) as
      | AppointmentRow
      | undefined;
    return r ? rowToAppt(r) : null;
  }

  list(): Appointment[] {
    const rows = this.db
      .prepare('SELECT * FROM appointment ORDER BY starts_at')
      .all() as AppointmentRow[];
    return rows.map(rowToAppt);
  }

  listForClient(clientId: string): Appointment[] {
    const rows = this.db
      .prepare('SELECT * FROM appointment WHERE client_id = ? ORDER BY starts_at')
      .all(clientId) as AppointmentRow[];
    return rows.map(rowToAppt);
  }

  setFeeFlag(id: string, on: boolean): void {
    this.db
      .prepare('UPDATE appointment SET fee_flag = ?, updated_at = ? WHERE id = ?')
      .run(boolToInt(on), this.clock.nowIso(), id);
  }

  /** Move an appointment to a new time (and optionally duration). Scheduling-only;
   * does not touch status, so a rescheduled appointment stays 'scheduled'. */
  reschedule(id: string, startsAt: string, durationMinutes?: number): Appointment {
    const now = this.clock.nowIso();
    if (durationMinutes != null) {
      this.db
        .prepare(
          'UPDATE appointment SET starts_at = @starts_at, duration_minutes = @dur, updated_at = @now WHERE id = @id'
        )
        .run({ id, starts_at: startsAt, dur: durationMinutes, now });
    } else {
      this.db
        .prepare('UPDATE appointment SET starts_at = @starts_at, updated_at = @now WHERE id = @id')
        .run({ id, starts_at: startsAt, now });
    }
    return this.get(id)!;
  }

  /** Set the status enum directly (used for confirm/complete/no_show). */
  setStatus(id: string, status: AppointmentStatus): Appointment {
    this.db
      .prepare('UPDATE appointment SET status = @status, updated_at = @now WHERE id = @id')
      .run({ id, status, now: this.clock.nowIso() });
    return this.get(id)!;
  }

  /** Cancel by the party who cancelled. Maps to the two cancellation enum values. */
  cancel(id: string, by: 'client' | 'clinician'): Appointment {
    const status: AppointmentStatus =
      by === 'client' ? 'cancelled_by_client' : 'cancelled_by_clinician';
    return this.setStatus(id, status);
  }
}
