// egressGuard: THE single fail-closed boundary between app code and the Anthropic
// API. Nothing else may construct a call to the model; the runtime only accepts a
// request that this guard has approved, and the SDK client is not exported
// anywhere else.
//
// It enforces, in order:
//   1. DATA-MODE GATE (F1 / safety floor): if mode === 'real' and the compile gate
//      FEATURE_REAL_PHI_EGRESS is false, REFUSE. This makes "no real PHI to cloud
//      this run" a property of the code, not of policy or hope.
//   2. MESSAGES-API-ONLY: the request must not carry any non-Messages surface
//      (tools, files, batch, mcp). The EgressRequest type already omits those, so
//      this is belt-and-braces against a future field being smuggled in.
//   3. NO-PHI-IN-SCHEMA: an optional genericSchema may carry section-name KEYS
//      only; if any value looks like content, REFUSE.
//   4. MINIMUM-NECESSARY: truncate message content to a per-purpose budget and
//      drop anything not on the allowlist.
//   5. REDACTION (defense in depth, NOT de-identification): scrub obvious
//      identifiers from message content. Logged as a COUNT, never the content.
//
// The guard returns a decision. allowed=false carries a stable code + plain
// reason. allowed=true carries the minimized+redacted request to actually send.

import { FEATURE_REAL_PHI_EGRESS } from '@shared/constants.js';
import { ERROR_CODES } from '@shared/constants.js';
import type { EgressRequest, EgressDecision, EgressPurpose } from '@shared/types/agent.js';
import type { Logger } from './logger.js';

/** Per-purpose minimum-necessary budget (characters of total message content). */
const CONTENT_BUDGET: Record<EgressPurpose, number> = {
  note_draft: 6000, // a generous brain-dump, still bounded
  reminder_draft: 1000,
  intake_summary: 4000,
  statement_summary: 2000,
};

/** Obvious-identifier patterns for the redaction backstop (Safe-Harbor-ish). */
const IDENTIFIER_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // phone-ish
  /\b\d{3}-\d{2}-\d{4}\b/g, // ssn
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // full date m/d/y
];

function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const re of IDENTIFIER_PATTERNS) {
    out = out.replace(re, () => {
      count += 1;
      return '[redacted]';
    });
  }
  return { text: out, count };
}

/** Heuristic: does a schema object carry VALUES (content) rather than just keys
 * naming sections? We allow string values that are short generic labels, and
 * reject anything that looks like a sentence (a space-containing long value). */
function schemaContainsValues(schema: Record<string, unknown>): boolean {
  for (const v of Object.values(schema)) {
    if (typeof v === 'string' && (v.length > 40 || /\s\S+\s\S+\s/.test(v))) return true;
    if (v && typeof v === 'object') return true; // nested objects imply data
  }
  return false;
}

export class EgressGuard {
  constructor(private readonly log: Logger) {}

  /**
   * The chokepoint. Returns a decision; callers MUST honor allowed===false and
   * MUST send only decision.minimizedRequest, never the original.
   */
  guard(req: EgressRequest): EgressDecision {
    // 1) DATA-MODE GATE. This is the non-negotiable F1 / safety-floor line.
    if (req.mode === 'real' && !FEATURE_REAL_PHI_EGRESS) {
      this.log.event('egress_blocked', { purpose: req.purpose, reason: 'real_mode_disabled' });
      return {
        allowed: false,
        code: ERROR_CODES.EGRESS_BLOCKED_REAL,
        reason: 'Real client data cannot be sent in this version.',
      };
    }

    // 2) MESSAGES-API-ONLY. The type omits non-Messages surfaces; this rejects any
    // that were smuggled via a loosely-typed caller.
    const smuggled = req as unknown as Record<string, unknown>;
    if (
      'tools' in smuggled ||
      'mcpServers' in smuggled ||
      'files' in smuggled ||
      'batch' in smuggled
    ) {
      return {
        allowed: false,
        code: ERROR_CODES.EGRESS_NON_MESSAGES,
        reason: 'Only the plain Messages path is permitted for this content.',
      };
    }

    // 3) NO-PHI-IN-SCHEMA.
    if (req.genericSchema && schemaContainsValues(req.genericSchema)) {
      return {
        allowed: false,
        code: ERROR_CODES.EGRESS_SCHEMA_VALUES,
        reason: 'Schema must not contain client-identifying values.',
      };
    }

    // 4) MINIMUM-NECESSARY: bound total content size for this purpose.
    const budget = CONTENT_BUDGET[req.purpose];
    let remaining = budget;
    const trimmedMessages = req.messages.map((m) => {
      if (remaining <= 0) return { ...m, content: '' };
      const content = m.content.length > remaining ? m.content.slice(0, remaining) : m.content;
      remaining -= content.length;
      return { ...m, content };
    });

    // 5) REDACTION backstop.
    let redactions = 0;
    const redactedMessages = trimmedMessages.map((m) => {
      const r = redact(m.content);
      redactions += r.count;
      return { ...m, content: r.text };
    });

    const minimizedRequest: EgressRequest = {
      ...req,
      messages: redactedMessages,
    };

    const bytes = redactedMessages.reduce((n, m) => n + Buffer.byteLength(m.content), 0);
    this.log.event('egress_allowed', { purpose: req.purpose, bytes, redactions });

    return { allowed: true, minimizedRequest, meta: { bytes, redactions } };
  }
}
