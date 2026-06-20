// MockDraftProvider: deterministic, OFFLINE, no key, no spend, no network.
//
// This is the DEFAULT provider whenever no API key is configured or the data mode
// is synthetic. It still runs the request through the EgressGuard (so the
// synthetic path exercises the real chokepoint and proves it routes correctly),
// but it NEVER touches the network: it composes a realistic structured draft from
// the synthetic shorthand locally. This is what makes the full session-notes flow
// demonstrable and unit-testable right now with no Anthropic dependency.
//
// The output is deliberately run through stripDashes (F5) just like real output,
// and it intentionally never produces em dashes, so the post-processor invariant
// holds on the synthetic path too.

import type {
  ModelProvider,
  DraftNoteInput,
  DraftNoteResult,
} from '@shared/types/agent.js';
import type { EgressGuard } from '../egressGuard.js';
import { buildNoteDraftRequest } from './buildNoteRequest.js';
import { stripDashes } from '../textPostProcess.js';

export class MockDraftProvider implements ModelProvider {
  readonly name = 'mock';

  constructor(private readonly guard: EgressGuard) {}

  async draftNote(input: DraftNoteInput): Promise<DraftNoteResult> {
    // Build and guard the request exactly like the real provider would. We do not
    // send it anywhere; guarding it proves the synthetic path is gated and
    // minimized. If the guard refuses (it will not for synthetic mode), surface
    // that rather than silently drafting.
    const req = buildNoteDraftRequest(input);
    const decision = this.guard.guard(req);
    if (!decision.allowed) {
      const err = new Error(decision.reason ?? 'Egress was not allowed.');
      (err as NodeJS.ErrnoException).code = decision.code;
      throw err;
    }

    // Compose a realistic draft per section from the shorthand, deterministically.
    const firstLine = input.shorthand.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
    const summary = firstLine.length > 0 ? firstLine.replace(/[.;]+$/, '') : 'the session';

    const sections = input.sections.map((s) => ({
      key: s.key,
      label: s.label,
      body: stripDashes(this.bodyFor(s.key, summary, input)),
    }));

    return { sections, provider: this.name, ai_assisted: true };
  }

  /** Deterministic section text. Generic, clinical, no invented identifiers. */
  private bodyFor(key: string, summary: string, input: DraftNoteInput): string {
    const cue = input.cues;
    const riskLine = cue?.riskFlagPresent
      ? ' A risk topic was reviewed during the session and addressed directly.'
      : '';
    const homeworkLine = cue?.homeworkAssigned
      ? ' A between-session task was agreed for the client to practice before the next session.'
      : '';
    switch (key) {
      case 'subjective':
      case 'data':
      case 'behavior':
        return `The client reported on ${summary}. The clinician noted the client was engaged and able to describe their experience.${riskLine}`;
      case 'objective':
        return `The client presented as alert and oriented. Mood and affect were consistent with the reported content.${riskLine}`;
      case 'intervention':
        return `The clinician used reflective listening and a brief skills-based intervention focused on ${summary}.`;
      case 'response':
        return `The client responded with increased insight and willingness to continue work on ${summary}.${homeworkLine}`;
      case 'assessment':
        return `Working clinical impression: the client continues to address ${summary}. Progress is consistent with the current treatment plan.`;
      case 'plan':
        return `Continue the current approach. Review progress on ${summary} at the next session.${homeworkLine}`;
      default:
        return `Notes regarding ${summary}.`;
    }
  }
}
