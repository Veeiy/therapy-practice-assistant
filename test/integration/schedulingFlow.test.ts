// INTEGRATION TEST: the scheduling + reminders workflow (#3 of 4), over the real
// SchedulingService + Appointments/Reminders repositories + EgressGuard stack on an
// encrypted DB.
//
// What it proves:
//   * APPOINTMENT CRUD: create -> reschedule -> cancel and explicit setStatus all
//     persist and map the cancel actor to the right status enum.
//   * REMINDER STAGING, NEVER SENDING (HARD TIER-1): previewReminder returns the
//     exact text and writes NOTHING; stageReminder composes + schedules + queues a
//     row with status 'scheduled'; the OUTBOX lists it. There is NO send path on the
//     service, and the staged row never becomes 'sent' on its own.
//   * MINIMUM-NECESSARY TEXT (F7): the default reminder confirms only that an
//     appointment exists plus date/time/practice name. It carries NO diagnosis and
//     NO clinical detail (we assert neither the client's presenting concern nor any
//     clinical word leaks into the body).
//   * SCHEDULED SEND TIME: send_at = appointment start minus the configured leadHours.
//   * DASH-FREE (F5): the composed subject + body carry no prohibited dash.
//   * AUDIT (F4): staging records the action + IDs only, never the reminder text.

import { describe, it, expect, afterEach } from 'vitest';
import { SchedulingService } from '../../src/modules/scheduling/schedulingService.js';
import { EgressGuard } from '../../src/main/agent/egressGuard.js';
import { silentLogger } from '../../src/main/agent/logger.js';
import { hasProhibitedDash } from '../../src/main/agent/textPostProcess.js';
import { freshStore } from '../helpers.js';

const TEMPLATE =
  'Hello {{preferred_name}}, this is a reminder of your appointment on ' +
  '{{date}} at {{time}}. Reply to this email if you need to reschedule. Thank you.';
const PRACTICE = 'Sample Therapy Practice';
const LEAD_HOURS = 24;

describe('scheduling + reminders flow (workflow 3, integration)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  function setup() {
    const { store, cleanup } = freshStore();
    cleanups.push(cleanup);
    const guard = new EgressGuard(silentLogger);
    const service = new SchedulingService({
      appointments: store.appointments,
      reminders: store.reminders,
      clients: store.clients,
      audit: store.audit,
      guard,
      dataMode: () => 'synthetic',
      config: {
        reminderTemplate: () => TEMPLATE,
        leadHours: () => LEAD_HOURS,
        practiceName: () => PRACTICE,
      },
    });
    const client = store.clients.create({
      legal_first_name: 'Sam',
      legal_last_name: 'Sample',
      preferred_name: 'Sam',
      preferred_contact_method: 'email',
      email: 'sam.sample@example.com',
      // a CLINICAL detail that must NEVER appear in a reminder (minimum-necessary)
      presenting_concern: 'Generalized anxiety and insomnia.',
      consent_on_file: true,
      demo: 1,
    });
    return { store, service, clientId: client.id };
  }

  it('creates, reschedules, sets status, and cancels an appointment', () => {
    const { service, clientId } = setup();
    const appt = service.create({
      client_id: clientId,
      starts_at: '2026-06-22T15:00:00.000Z',
      duration_minutes: 50,
      modality: 'telehealth',
    });
    expect(appt.status).toBe('scheduled');

    const moved = service.reschedule(appt.id, '2026-06-23T16:00:00.000Z', 60);
    expect(moved.starts_at).toBe('2026-06-23T16:00:00.000Z');
    expect(moved.duration_minutes).toBe(60);
    expect(moved.status).toBe('scheduled'); // reschedule does not change status

    const confirmed = service.setStatus(appt.id, 'confirmed');
    expect(confirmed.status).toBe('confirmed');

    const cancelled = service.cancel(appt.id, 'client');
    expect(cancelled.status).toBe('cancelled_by_client');
  });

  it('previews the exact reminder text and writes NOTHING', () => {
    const { service, store, clientId } = setup();
    const appt = service.create({
      client_id: clientId,
      starts_at: '2026-06-22T15:00:00.000Z',
      modality: 'telehealth',
    });

    const preview = service.previewReminder(appt.id);
    expect(preview.channel).toBe('email');
    expect(preview.to).toBe('sam.sample@example.com');
    expect(preview.body).toContain('Sam'); // preferred name filled
    expect(preview.body).toContain('reminder of your appointment');
    // send_at = start - leadHours
    expect(preview.send_at).toBe('2026-06-21T15:00:00.000Z');
    // PREVIEW WROTE NOTHING: the outbox is still empty
    expect(service.outbox()).toHaveLength(0);
    expect(store.reminders.outbox()).toHaveLength(0);
  });

  it('stages a reminder into the OUTBOX (scheduled) and NEVER sends it (Tier-1)', () => {
    const { service, clientId } = setup();
    const appt = service.create({
      client_id: clientId,
      starts_at: '2026-06-22T15:00:00.000Z',
      modality: 'telehealth',
    });

    const staged = service.stageReminder(appt.id);
    expect(staged.status).toBe('scheduled'); // queued, not sent
    expect(staged.send_at).toBe('2026-06-21T15:00:00.000Z');
    expect(staged.preview.body.length).toBeGreaterThan(0);

    const outbox = service.outbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].id).toBe(staged.id);
    expect(outbox[0].status).toBe('scheduled'); // still scheduled; nothing sent it

    // THE GUARANTEE: there is no send method on the service surface.
    expect(
      (service as unknown as Record<string, unknown>).sendReminder
    ).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).send).toBeUndefined();
  });

  it('reminder body is MINIMUM-NECESSARY: no diagnosis or clinical detail (F7), dash-free (F5)', () => {
    const { service, clientId } = setup();
    const appt = service.create({
      client_id: clientId,
      starts_at: '2026-06-22T15:00:00.000Z',
      modality: 'telehealth',
    });
    const preview = service.previewReminder(appt.id);
    const text = `${preview.subject}\n${preview.body}`;

    // the client's presenting concern / diagnosis must NOT appear anywhere
    expect(text.toLowerCase()).not.toContain('anxiety');
    expect(text.toLowerCase()).not.toContain('insomnia');
    expect(text.toLowerCase()).not.toContain('diagnos');
    // it DOES confirm the neutral facts: an appointment, date/time, practice name
    expect(preview.subject).toContain(PRACTICE);
    expect(preview.body).toContain('reminder of your appointment');
    // F5
    expect(hasProhibitedDash(preview.subject)).toBe(false);
    expect(hasProhibitedDash(preview.body)).toBe(false);
  });

  it('audit records the staged action with IDs only, never the reminder text (F4)', () => {
    const { store, service, clientId } = setup();
    const appt = service.create({
      client_id: clientId,
      starts_at: '2026-06-22T15:00:00.000Z',
      modality: 'telehealth',
    });
    service.stageReminder(appt.id);

    const rows = store.audit.recent(50);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('appointment_create');
    expect(actions).toContain('reminder_staged');
    for (const r of rows) {
      const s = r.summary ?? '';
      expect(s).not.toContain('reminder of your appointment'); // no body text
      expect(s).not.toContain('sam.sample@example.com'); // no identifier
    }
  });

  it('AI draft-reminder stub is offline, dash-free, and carries no client identifier (F5)', () => {
    const { service, clientId } = setup();
    const appt = service.create({
      client_id: clientId,
      starts_at: '2026-06-22T15:00:00.000Z',
      modality: 'telehealth',
    });
    const { message } = service.draftReminder(appt.id);
    expect(message.length).toBeGreaterThan(0);
    expect(hasProhibitedDash(message)).toBe(false);
    expect(message).not.toContain('sam.sample@example.com');
    expect(message.toLowerCase()).not.toContain('anxiety');
  });
});
