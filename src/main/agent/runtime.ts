// runtime: the agent runtime the spine constructs once at startup.
//
// Responsibilities:
//   1. Resolve the absolute path to the asar-UNPACKED claude.exe. In a packaged
//      Electron app the SDK's native CLI is inside the @anthropic-ai package, which
//      we mark asarUnpack in electron-builder.yml so the .exe is extractable. The
//      runtime swaps "app.asar" -> "app.asar.unpacked" in the resolved module path
//      (researcher.2: the binary cannot be executed from inside the asar archive).
//   2. Build the EgressGuard, the Mock provider, and a factory for the real
//      provider, and expose selectProvider() so callers get the right one. In this
//      build that is ALWAYS the Mock (real egress is gated off), but the wiring is
//      complete and readable.
//   3. Optionally PREWARM by resolving the binary path eagerly so the first real
//      draft would not pay the lookup. (No process is spawned here; the SDK spawns
//      claude.exe only when a real query runs, which does not happen this build.)
//
// Nothing in here calls the network. The real provider is constructed only if and
// when selection chooses it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EgressGuard } from './egressGuard.js';
import { MockDraftProvider } from './providers/mockDraftProvider.js';
import { ClaudeAgentSdkProvider } from './providers/claudeAgentSdkProvider.js';
import { selectProvider } from './providers/providerSelector.js';
import type { Logger } from './logger.js';
import type { ModelProvider } from '@shared/types/agent.js';
import type { DataMode } from '@shared/constants.js';

export interface AgentRuntimeDeps {
  log: Logger;
  /** returns the decrypted Anthropic API key or null (from ApiKeyStore). */
  getApiKey: () => string | null;
  /** whether a key is present (presence only; does not unseal). */
  hasApiKey: () => boolean;
  /** the app's current data mode. */
  dataMode: () => DataMode;
}

/**
 * Resolve the on-disk path to the native claude CLI, accounting for asar packing.
 * Returns null if it cannot be found (then only the Mock path is ever usable,
 * which is exactly this build's situation on a dev/test host).
 */
export function resolveClaudeExecutable(): string | null {
  // Try to resolve the SDK package directory. Under Electron this resolves inside
  // app.asar; we then redirect to app.asar.unpacked where the binary actually lives.
  let sdkDir: string | null = null;
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@anthropic-ai/claude-agent-sdk/package.json');
    sdkDir = pkgJson.replace(/[\\/]package\.json$/, '');
  } catch {
    sdkDir = null;
  }
  if (!sdkDir) return null;

  // The win32 binary ships in the platform optional dependency. Candidate names
  // cover the packaged layout; the first that exists wins. We also redirect asar.
  const unpacked = sdkDir.replace('app.asar', 'app.asar.unpacked');
  const roots = [unpacked, sdkDir];
  const rel = [
    join('..', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe'),
    join('vendor', 'claude.exe'),
    'claude.exe',
  ];
  for (const root of roots) {
    for (const r of rel) {
      const candidate = join(root, r);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export class AgentRuntime {
  private readonly guard: EgressGuard;
  private readonly mock: MockDraftProvider;
  private readonly claudePath: string | null;

  constructor(private readonly deps: AgentRuntimeDeps) {
    this.guard = new EgressGuard(deps.log);
    this.mock = new MockDraftProvider(this.guard);
    // Prewarm: resolve the binary path once now (cheap, no spawn).
    this.claudePath = resolveClaudeExecutable();
    this.deps.log.event('agent_runtime_ready', {
      claudeBinaryResolved: this.claudePath !== null,
      // never log the path itself in case it embeds a username; just whether found
    });
  }

  /** The provider the current state selects. Mock in this build, always. */
  provider(): ModelProvider {
    return selectProvider({
      mock: this.mock,
      makeReal: () =>
        new ClaudeAgentSdkProvider({
          guard: this.guard,
          log: this.deps.log,
          // if the binary is missing we still construct (selection would not reach
          // here in this build); an empty string would fail clearly at call time.
          pathToClaudeCodeExecutable: this.claudePath ?? '',
          getApiKey: this.deps.getApiKey,
        }),
      hasApiKey: this.deps.hasApiKey(),
      dataMode: this.deps.dataMode(),
    });
  }

  /** Expose the guard so non-notes modules can reuse the same chokepoint. */
  egressGuard(): EgressGuard {
    return this.guard;
  }
}
