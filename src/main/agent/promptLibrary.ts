// promptLibrary: versioned, generic system prompts. These contain FORMATTING
// instructions only. They never contain patient data, names, identifiers, or any
// PHI. A module asks the library for a prompt by purpose+format; the library
// returns generic text.
//
// F5 (half 1): every prompt that produces operator-facing or client-facing text
// carries an explicit instruction to avoid em and en dashes. The deterministic
// stripDashes() pass (textPostProcess.ts) is the guarantee; this is the hint.

import type { NoteFormat } from '@shared/types/domain.js';

/** The shared style/safety preamble appended to every clinical-drafting prompt. */
const STYLE_RULES = [
  'Write in plain, professional clinical language.',
  'Do not use em dashes or en dashes anywhere. Use periods, commas, or the word "to" for ranges.',
  'Refer to the person only as "the client". Do not invent or assume a name.',
  'Do not invent facts that are not present in the clinician shorthand. If a section has no supporting information, write a brief neutral placeholder such as "No additional information was noted.".',
  'This is a draft for the clinician to review and edit. Do not sign, finalize, or add legal or billing conclusions.',
].join(' ');

const FORMAT_GUIDANCE: Record<NoteFormat, string> = {
  SOAP: 'Produce a SOAP progress note. Subjective is what the client reports. Objective is the clinician\'s observations. Assessment is the clinical impression. Plan is next steps.',
  DAP: 'Produce a DAP progress note. Data combines what the client reports and what the clinician observed. Assessment is the clinical impression. Plan is next steps.',
  BIRP: 'Produce a BIRP progress note. Behavior is the presentation and reported experience. Intervention is what the clinician did. Response is how the client responded. Plan is next steps.',
};

export const PROMPT_VERSION = 'note_draft@v1';

/** Build the generic note-draft system prompt for a format. PHI-free by design. */
export function noteDraftSystemPrompt(format: NoteFormat): string {
  return [
    `You are assisting a licensed therapist by expanding brief clinician shorthand into a structured ${format} progress note.`,
    FORMAT_GUIDANCE[format],
    STYLE_RULES,
    `Return one labeled section per ${format} section, in order. Keep each section concise and grounded in the shorthand.`,
  ].join('\n');
}
