// TEST: the EgressGuard chokepoint (F1 / safety floor).
//
// This is the single fail-closed boundary to the model. We prove its five rules:
//  (1) DATA-MODE GATE: mode='real' is REFUSED while FEATURE_REAL_PHI_EGRESS is
//      false, with the stable code EGRESS_BLOCKED_REAL. This is the property that
//      makes "no real PHI to cloud this run" true in the code, not in policy.
//  (2) synthetic mode is ALLOWED and returns a minimized request.
//  (3) MESSAGES-ONLY: a request with a smuggled `tools`/`mcpServers`/`files`/`batch`
//      field is REFUSED (belt-and-braces against a loosely-typed caller).
//  (4) NO-PHI-IN-SCHEMA: a genericSchema carrying sentence-like VALUES is REFUSED;
//      one carrying only short section-name keys is allowed.
//  (5) MINIMUM-NECESSARY + REDACTION: oversized content is truncated to the
//      per-purpose budget, and obvious identifiers (email/phone) are scrubbed and
//      counted (never logged as content).
//
// And, crucially, that the MockDraftProvider (the default offline path) ROUTES
// THROUGH this guard: a synthetic draft succeeds, and if asked in real mode the
// provider surfaces the block instead of drafting.

import { describe, it, expect } from 'vitest';
import { EgressGuard } from '../../src/main/agent/egressGuard.js';
import { MockDraftProvider } from '../../src/main/agent/providers/mockDraftProvider.js';
import { silentLogger } from '../../src/main/agent/logger.js';
import { ERROR_CODES } from '../../src/shared/constants.js';
import type { EgressRequest } from '../../src/shared/types/agent.js';
import type { DraftNoteInput } from '../../src/shared/types/agent.js';

function baseReq(over: Partial<EgressRequest> = {}): EgressRequest {
  return {
    purpose: 'note_draft',
    system: 'Format only. No client data.',
    messages: [{ role: 'user', content: 'Expand this shorthand into a note.' }],
    maxTokens: 1200,
    mode: 'synthetic',
    ...over,
  };
}

describe('EgressGuard', () => {
  const guard = new EgressGuard(silentLogger);

  it('(1) blocks real-mode egress while the feature gate is false', () => {
    const decision = guard.guard(baseReq({ mode: 'real' }));
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe(ERROR_CODES.EGRESS_BLOCKED_REAL);
    expect(decision.minimizedRequest).toBeUndefined();
    // and the reason is plain language, no jargon
    expect(decision.reason).toMatch(/cannot be sent/i);
  });

  it('(2) allows synthetic-mode egress and returns a minimized request', () => {
    const decision = guard.guard(baseReq({ mode: 'synthetic' }));
    expect(decision.allowed).toBe(true);
    expect(decision.minimizedRequest).toBeDefined();
    expect(decision.minimizedRequest!.messages.length).toBe(1);
    expect(decision.meta!.bytes).toBeGreaterThan(0);
  });

  it('(3) refuses a request carrying a non-Messages surface (tools/mcp/files/batch)', () => {
    for (const field of ['tools', 'mcpServers', 'files', 'batch']) {
      const smuggled = { ...baseReq(), [field]: [{ x: 1 }] } as unknown as EgressRequest;
      const decision = guard.guard(smuggled);
      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe(ERROR_CODES.EGRESS_NON_MESSAGES);
    }
  });

  it('(4) refuses a schema with content-like values but allows section-name keys', () => {
    const withValues = baseReq({
      genericSchema: { subjective: 'The client reported sleeping poorly all week again' },
    });
    expect(guard.guard(withValues).allowed).toBe(false);
    expect(guard.guard(withValues).code).toBe(ERROR_CODES.EGRESS_SCHEMA_VALUES);

    const keysOnly = baseReq({
      genericSchema: { subjective: 'text', objective: 'text', plan: 'text' },
    });
    expect(guard.guard(keysOnly).allowed).toBe(true);
  });

  it('(5) truncates to the per-purpose budget and redacts obvious identifiers', () => {
    const huge = 'A'.repeat(10_000); // > note_draft budget of 6000
    const decision = guard.guard(
      baseReq({ messages: [{ role: 'user', content: huge }] })
    );
    expect(decision.allowed).toBe(true);
    expect(decision.minimizedRequest!.messages[0].content.length).toBeLessThanOrEqual(6000);

    // redaction: an email + phone in content become [redacted] and are counted
    const withIds = guard.guard(
      baseReq({
        messages: [
          { role: 'user', content: 'Reach me at sam.sample@example.com or 555-123-4567 ok.' },
        ],
      })
    );
    expect(withIds.allowed).toBe(true);
    const out = withIds.minimizedRequest!.messages[0].content;
    expect(out).not.toContain('sam.sample@example.com');
    expect(out).not.toContain('555-123-4567');
    expect(out).toContain('[redacted]');
    expect(withIds.meta!.redactions).toBeGreaterThanOrEqual(2);
  });

  it('routes the Mock provider THROUGH the guard: synthetic drafts, real is blocked', async () => {
    const provider = new MockDraftProvider(guard);
    const input: DraftNoteInput = {
      format: 'SOAP',
      sections: [
        { key: 'subjective', label: 'Subjective' },
        { key: 'objective', label: 'Objective' },
        { key: 'assessment', label: 'Assessment' },
        { key: 'plan', label: 'Plan' },
      ],
      shorthand: 'client discussed sleep and stress; agreed on a breathing exercise',
      mode: 'synthetic',
    };

    // synthetic: offline draft succeeds with all four sections, no network
    const result = await provider.draftNote(input);
    expect(result.provider).toBe('mock');
    expect(result.ai_assisted).toBe(true);
    expect(result.sections.map((s) => s.key)).toEqual([
      'subjective',
      'objective',
      'assessment',
      'plan',
    ]);
    expect(result.sections.every((s) => s.body.length > 0)).toBe(true);

    // real: the same provider must surface the guard's block, not draft
    await expect(provider.draftNote({ ...input, mode: 'real' })).rejects.toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EGRESS_BLOCKED_REAL })
    );
  });
});
