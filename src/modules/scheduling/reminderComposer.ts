// reminderComposer: turn the operator-editable, MINIMUM-NECESSARY reminder template
// (F7, lives in config under reminders.defaultTemplate) into the exact text that
// WOULD be sent for a given appointment, by filling {{placeholders}} from the
// appointment + client.
//
// Two binding constraints live here:
//   * F7 minimum-necessary: the DEFAULT template confirms only that an appointment
//     exists plus date/time/practice name. It carries NO diagnosis and NO clinical
//     detail. This composer never adds any; it only substitutes the placeholders the
//     template asks for. If the operator edits the template to add sensitive detail,
//     that is their explicit choice, but the shipped default stays bland.
//   * F5 no em dashes: the composed text is run through stripDashes before return.
//
// It does NOT send. It returns text for a PREVIEW and for the staged outbox row. The
// only place client text appears is the filled body; the model is never involved in
// composing a reminder (the AI "draft reminder" stub is a separate, generic helper).

import type { Appointment, Client } from '@shared/types/domain.js';
import type { ReminderPreview } from '@shared/types/ipc.js';
import { stripDashes } from '@main/agent/textPostProcess.js';

export interface ComposeDeps {
  template: string;
  practiceName: string;
}

/** The placeholders the default template understands. Adding a new {{token}} to the
 * template is supported as long as a value is provided here; unknown tokens are left
 * intact so the operator can see they were not filled (visible in the preview). */
function fillPlaceholders(
  template: string,
  values: Record<string, string>
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const text = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (key in values && values[key] !== '') return values[key];
    unresolved.push(key);
    return `{{${key}}}`; // keep it visible so the operator notices a gap
  });
  return { text, unresolved };
}

/** Format an ISO datetime into a plain, human date + time for the reminder. Kept
 * deliberately simple and locale-stable so the preview text is deterministic. */
function formatDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: '' };
  // e.g. "Mon Jun 22, 2026" and "14:30" (24h, stable across machines)
  const date = d.toUTCString().slice(0, 16).trim(); // "Mon, 22 Jun 2026"
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return { date, time: `${hh}:${mm}` };
}

/**
 * Compose the exact reminder preview for an appointment. NEVER sends. The returned
 * `body` is the literal text that the operator would later send by email.
 */
export function composeReminder(
  appointment: Appointment,
  client: Client | null,
  deps: ComposeDeps
): ReminderPreview {
  const warnings: string[] = [];
  const { date, time } = formatDate(appointment.starts_at);

  const preferred =
    client?.preferred_name?.trim() ||
    client?.legal_first_name?.trim() ||
    'there';

  const { text, unresolved } = fillPlaceholders(deps.template, {
    preferred_name: preferred,
    date,
    time,
    practice_name: deps.practiceName,
  });

  // Minimum-necessary check is structural: the default template references only
  // these neutral tokens. We surface unresolved tokens as warnings, not errors.
  for (const u of unresolved) warnings.push(`Template placeholder not filled: {{${u}}}.`);

  const to = client?.email ?? null;
  if (!to) warnings.push('Client has no email on file. Add one before sending.');
  if (client && client.preferred_contact_method !== 'email') {
    warnings.push('Client preferred contact method is not email.');
  }

  const subject = stripDashes(`Appointment reminder from ${deps.practiceName}`);
  const body = stripDashes(text);

  return {
    appointment_id: appointment.id,
    channel: 'email',
    to,
    send_at: '', // filled by the service from leadHours; composer is time-agnostic
    subject,
    body,
    warnings,
  };
}
