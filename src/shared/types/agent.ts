// Agent + egress types shared between the modules (which build requests) and the
// spine runtime (which executes them). These are the shapes that flow THROUGH the
// EgressGuard. Keeping them in @shared lets a module construct a request without
// importing any SDK code, which is the whole point of the provider abstraction.

import type { DataMode } from '../constants.js';

/** The purpose tags the guard knows. Each maps to a minimum-necessary field
 * allowlist and a size budget. Note draft is the functional one; the other three
 * are wired stubs on the same plumbing. */
export type EgressPurpose =
  | 'note_draft'
  | 'reminder_draft'
  | 'intake_summary'
  | 'statement_summary';

export interface EgressMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The ONLY shape that may reach the model. A module hands this to the provider;
 * the provider hands it to the EgressGuard; nothing else can call the SDK.
 *
 * Note the deliberate absence: there is no `tools`, no `files`, no `mcpServers`,
 * no `batch` field. The type itself only describes the Messages surface (F1).
 */
export interface EgressRequest {
  purpose: EgressPurpose;
  /** generic, versioned, asserted PHI-free. Formatting instructions, not data. */
  system: string;
  /** the only place client text rides. Minimum-necessary, redacted by the guard. */
  messages: EgressMessage[];
  maxTokens: number;
  /** the data mode this request is tagged with. real-mode is blocked this build. */
  mode: DataMode;
  /** optional generic schema whose KEYS are section names only; never values. */
  genericSchema?: Record<string, unknown>;
}

/** The guard's verdict. allowed=false carries a code + plain reason. */
export interface EgressDecision {
  allowed: boolean;
  code?: string;
  reason?: string;
  /** present only when allowed: the minimized, redacted request to actually send. */
  minimizedRequest?: EgressRequest;
  /** non-PHI metadata for the audit log (counts, byte size). */
  meta?: { bytes: number; redactions: number };
}

// ── the notes flow's provider shape ───────────────────────────────────────────

/** Input the notes service hands the provider to draft a note. Read from the
 * encrypted DB in the main process; only the minimum-necessary subset becomes an
 * EgressRequest. */
export interface DraftNoteInput {
  format: 'SOAP' | 'DAP' | 'BIRP';
  /** ordered section keys+labels for this format, from config. */
  sections: { key: string; label: string }[];
  /** the therapist's typed shorthand (minimum necessary). */
  shorthand: string;
  /** light, non-identifying structure cues (booleans only, never PHI). */
  cues?: {
    presentingFocus?: boolean;
    riskFlagPresent?: boolean;
    homeworkAssigned?: boolean;
    sessionNumber?: number;
    modality?: 'in_person' | 'telehealth';
    durationMinutes?: number;
  };
  mode: DataMode;
}

/** A drafted note: section bodies keyed by section key, plus provenance. */
export interface DraftNoteResult {
  sections: { key: string; label: string; body: string }[];
  /** which provider produced it ('mock' | 'claude-agent-sdk'). */
  provider: string;
  ai_assisted: boolean;
}

/**
 * The abstraction you learn the SDK through. Two implementations:
 * - MockDraftProvider: offline, deterministic, no key, no network, no spend.
 * - ClaudeAgentSdkProvider: the real SDK with the F1 lockdown.
 * The selector picks Mock unless a real key exists AND real-PHI egress is enabled.
 */
export interface ModelProvider {
  readonly name: string;
  draftNote(input: DraftNoteInput): Promise<DraftNoteResult>;
}
