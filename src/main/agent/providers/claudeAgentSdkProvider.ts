// ClaudeAgentSdkProvider: the REAL provider, built on @anthropic-ai/claude-agent-sdk.
//
// THIS FILE IS WHERE THE F1 LOCKDOWN LIVES. It is the ONLY module in the codebase
// that imports the SDK. It is never imported by tests, and the provider selector
// never returns it unless a real key exists AND the real-PHI egress gate is on
// (which it is not in this build). So in this run it is wired and readable but
// never executed.
//
// Read this top to bottom as the SDK teaching unit.
//
// ──────────────────────────────────────────────────────────────────────────────
// The F1 lockdown, point by point (audit Required Fix 1), all applied in buildOptions():
//   * disable ALL tools                -> allowedTools: [], disallowedTools: ['*'], permissionMode 'plan'
//   * register NO MCP servers          -> mcpServers: {}
//   * no web / no file / no bash access-> the above plus a settingSources: [] (load no project config)
//   * pin the model explicitly         -> model: PINNED_MODEL
//   * disable prompt caching on PHI    -> env CLAUDE_DISABLE_PROMPT_CACHING + no cache_control blocks
//   * disable telemetry + auto-update  -> env DISABLE_TELEMETRY / DISABLE_AUTOUPDATER / ERROR_REPORTING
//   * spread process.env FIRST         -> env: { ...process.env, <overrides> } (SDK REPLACES env, not merges)
// Nothing else in the app can reach the network through the model, because the
// EgressGuard is the only path here and it has already approved a minimized,
// redacted, Messages-only request before this provider runs.
// ──────────────────────────────────────────────────────────────────────────────

import type {
  ModelProvider,
  DraftNoteInput,
  DraftNoteResult,
  EgressRequest,
} from '@shared/types/agent.js';
import { PINNED_MODEL } from '@shared/constants.js';
import type { EgressGuard } from '../egressGuard.js';
import type { Logger } from '../logger.js';
import { buildNoteDraftRequest } from './buildNoteRequest.js';
import { stripDashes } from '../textPostProcess.js';
import { parseSectionsFromText } from './parseSections.js';

export interface ClaudeProviderDeps {
  guard: EgressGuard;
  log: Logger;
  /** absolute path to the asar-unpacked claude.exe (runtime resolves this). */
  pathToClaudeCodeExecutable: string;
  /** returns the decrypted Anthropic API key, or null if none is set. The key is
   * unsealed in memory only when a call is about to be made; never logged. */
  getApiKey: () => string | null;
}

export class ClaudeAgentSdkProvider implements ModelProvider {
  readonly name = 'claude-agent-sdk';

  constructor(private readonly deps: ClaudeProviderDeps) {}

  async draftNote(input: DraftNoteInput): Promise<DraftNoteResult> {
    const req = buildNoteDraftRequest(input);
    const decision = this.deps.guard.guard(req);
    if (!decision.allowed) {
      const err = new Error(decision.reason ?? 'Egress was not allowed.');
      (err as NodeJS.ErrnoException).code = decision.code;
      throw err;
    }
    const minimized = decision.minimizedRequest!;

    const apiKey = this.deps.getApiKey();
    if (!apiKey) {
      const err = new Error('No Anthropic API key is configured.');
      (err as NodeJS.ErrnoException).code = 'NO_API_KEY';
      throw err;
    }

    const text = await this.runQuery(minimized, apiKey);

    // F5: deterministically strip any em/en dash the model produced before the
    // text is shown or saved.
    const cleaned = stripDashes(text);
    const sections = parseSectionsFromText(cleaned, input.sections);
    return { sections, provider: this.name, ai_assisted: true };
  }

  /**
   * The single SDK call site. Imports the SDK lazily so the rest of the app (and
   * the tests) never load it. Applies the full F1 lockdown via buildOptions().
   */
  private async runQuery(req: EgressRequest, apiKey: string): Promise<string> {
    // Lazy import: keeps the SDK out of every code path that does not call it.
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const options = this.buildOptions(req, apiKey);

    this.deps.log.event('sdk_query_start', {
      purpose: req.purpose,
      model: PINNED_MODEL,
      // never log the prompt or key; only metadata
      maxTokens: req.maxTokens,
    });

    let out = '';
    try {
      // The Messages-style single-turn call. We pass the user content as the
      // prompt and the generic system text via options. We do NOT stream tools,
      // because tools are disabled by the lockdown.
      const userPrompt = req.messages.map((m) => m.content).join('\n\n');
      for await (const message of query({ prompt: userPrompt, options })) {
        // Accumulate only assistant text content. The lockdown means there are no
        // tool_use blocks to handle.
        if (message.type === 'assistant') {
          const content = (message as { message?: { content?: unknown } }).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
                out += (block as { text?: string }).text ?? '';
              }
            }
          }
        }
      }
    } catch (e) {
      // F4: log a code + scrubbed message, never the request/response body.
      this.deps.log.error('sdk_query_error', e instanceof Error ? e.message : 'unknown', {
        purpose: req.purpose,
      });
      throw e;
    }

    this.deps.log.event('sdk_query_done', { purpose: req.purpose, bytes: Buffer.byteLength(out) });
    return out;
  }

  /**
   * Build the locked-down query() options. EVERY F1 control is here, with a
   * comment tying it to the fix. If you are learning the SDK, this function is the
   * security contract: it makes the non-Messages surfaces unreachable at the
   * process, not merely asserted on the request object.
   */
  private buildOptions(req: EgressRequest, apiKey: string): Record<string, unknown> {
    return {
      // ── pin the model (F1) ──
      model: PINNED_MODEL,

      // ── generic system prompt; PHI-free, already asserted by the guard ──
      systemPrompt: req.system,

      // ── disable ALL tools (F1): no file, web, bash, or code-execution tools ──
      allowedTools: [],
      disallowedTools: ['*'],
      // 'plan' mode does not execute tools; combined with the empty allowlist this
      // is belt-and-braces so nothing can act on the host or the network beyond
      // the Messages response.
      permissionMode: 'plan',

      // ── register NO MCP servers (F1) ──
      mcpServers: {},

      // ── load NO external/project settings (F1): the spawned engine must not
      // pick up a developer's local Claude config, tool registry, or MCP set ──
      settingSources: [],

      // ── pin the binary; never resolve 'claude' by PATH (researcher.2) ──
      pathToClaudeCodeExecutable: this.deps.pathToClaudeCodeExecutable,

      // ── bound the response ──
      maxTurns: 1,

      // ── env: spread process.env FIRST, then override. The SDK REPLACES the
      // subprocess env rather than merging, so a missing spread would strip
      // everything; an override-without-spread would leak inherited tool config.
      // (researcher.2 finding 4, F1.) ──
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        // disable prompt caching on this PHI-adjacent path (F1)
        CLAUDE_DISABLE_PROMPT_CACHING: '1',
        DISABLE_PROMPT_CACHING: '1',
        // disable telemetry / analytics / error reporting (F1, hard rules 1-2)
        DISABLE_TELEMETRY: '1',
        DISABLE_ERROR_REPORTING: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        // disable auto-update of the spawned binary (F1)
        DISABLE_AUTOUPDATER: '1',
        // do not let the engine offer to download or run extra components
        DISABLE_BUG_COMMAND: '1',
        // keep it non-interactive
        CI: '1',
      },
    };
  }
}
