// buildNoteRequest: turns the notes flow's DraftNoteInput into the generic,
// minimum-necessary EgressRequest both providers send through the guard.
//
// This is the concrete expression of product 3.4 / 5.1: the shorthand rides in
// message content; the format and generic section labels are instructions; the
// light cues are booleans/numbers, never identifying text. No client name, DOB,
// contact, prior note, or full record is ever placed here.

import type { DraftNoteInput, EgressRequest } from '@shared/types/agent.js';
import { noteDraftSystemPrompt } from '../promptLibrary.js';

export function buildNoteDraftRequest(input: DraftNoteInput): EgressRequest {
  const sectionLabels = input.sections.map((s) => s.label).join(', ');

  // Non-identifying cues, rendered as a short neutral preface. Booleans/numbers
  // only. None of these are Safe-Harbor identifiers.
  const cueParts: string[] = [];
  if (input.cues?.sessionNumber) cueParts.push(`Session number: ${input.cues.sessionNumber}.`);
  if (input.cues?.modality) cueParts.push(`Modality: ${input.cues.modality}.`);
  if (input.cues?.durationMinutes)
    cueParts.push(`Duration in minutes: ${input.cues.durationMinutes}.`);
  if (input.cues?.presentingFocus) cueParts.push('Focus on the presenting concern.');
  if (input.cues?.riskFlagPresent)
    cueParts.push('A risk topic was present; document it carefully and neutrally.');
  if (input.cues?.homeworkAssigned) cueParts.push('Homework or a between-session task was assigned.');
  const cueLine = cueParts.length ? cueParts.join(' ') + '\n\n' : '';

  const userContent =
    `Expand the following clinician shorthand into a ${input.format} progress note. ` +
    `Return these sections in order: ${sectionLabels}.\n\n` +
    cueLine +
    `Shorthand:\n${input.shorthand}`;

  return {
    purpose: 'note_draft',
    system: noteDraftSystemPrompt(input.format),
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 1200,
    mode: input.mode,
    // No genericSchema: we parse the returned text by section locally. Keeping
    // patient text out of any schema is the safest default (product 3.4).
  };
}
