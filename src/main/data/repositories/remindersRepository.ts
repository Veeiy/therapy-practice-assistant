// remindersRepository: the ONLY code that writes the reminder table SQL.
//
// F4: the reminder table is the ONE canonical reminder model. A reminder row is the
// scheduled intent to remind about an appointment. Its BODY TEXT is not stored as a
// column; the body is composed on demand from the operator-editable template
// (config) filled with appointment fields (reminderComposer.ts), so the text always
// reflects the current template and never goes stale or duplicates the model.
//
// Tier-1 staging: a reminder is created with status 'scheduled' and placed in the
// OUTBOX. NOTHING here sends. There is no send() method on purpose. Marking a
// reminder 'sent' is a future operator-side action (real SMTP), not an app action
// in this build.

import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import type { Reminder, ReminderStatus } from '@shared/types/domain.js';
import { type Clock, type IdGen } from './support.js';

interface ReminderRow {
  id: string;
  appointment_id: string;
  channel: 'email';
  send_at: string;
  status: ReminderStatus;
  template_id: string;
  last_error: string | null;
  demo: number;
  created_at: string;
  updated_at: string;
}

function rowToReminder(r: ReminderRow): Reminder {
  return {
    id: r.id,
    appointment_id: r.appointment_id,
    channel: r.channel,
    send_at: r.send_at,
    status: r.status,
    template_id: r.template_id,
    last_error: r.last_error,
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface StageReminderInput {
  appointment_id: string;
  send_at: string;
  template_id?: string;
  demo?: 0 | 1;
}

export class RemindersRepository {
  constructor(
    private readonly db: DB,
    private readonly clock: Clock,
    private readonly ids: IdGen
  ) {}

  /** Stage a reminder into the outbox with status 'scheduled'. This is the ONLY
   * write path, and it never sends. */
  stage(input: StageReminderInput): Reminder {
    const now = this.clock.nowIso();
    const id = this.ids.next();
    this.db
      .prepare(
        `INSERT INTO reminder
          (id, appointment_id, channel, send_at, status, template_id, last_error,
           demo, created_at, updated_at)
         VALUES
          (@id, @appointment_id, 'email', @send_at, 'scheduled', @template_id, NULL,
           @demo, @now, @now)`
      )
      .run({
        id,
        appointment_id: input.appointment_id,
        send_at: input.send_at,
        template_id: input.template_id ?? 'default_email',
        demo: input.demo ?? 0,
        now,
      });
    // F4: keep the denormalized appointment.reminder_status in sync with the latest
    // reminder state for this appointment (the schema documents this mirror).
    this.db
      .prepare('UPDATE appointment SET reminder_status = ?, updated_at = ? WHERE id = ?')
      .run('scheduled', now, input.appointment_id);
    return this.get(id)!;
  }

  get(id: string): Reminder | null {
    const r = this.db.prepare('SELECT * FROM reminder WHERE id = ?').get(id) as
      | ReminderRow
      | undefined;
    return r ? rowToReminder(r) : null;
  }

  /** The OUTBOX: every staged reminder, newest first. Nothing here has been sent. */
  outbox(): Reminder[] {
    const rows = this.db
      .prepare("SELECT * FROM reminder ORDER BY send_at ASC")
      .all() as ReminderRow[];
    return rows.map(rowToReminder);
  }

  forAppointment(appointmentId: string): Reminder[] {
    const rows = this.db
      .prepare('SELECT * FROM reminder WHERE appointment_id = ? ORDER BY send_at ASC')
      .all(appointmentId) as ReminderRow[];
    return rows.map(rowToReminder);
  }
}
