// providerSelector: decide which ModelProvider to use.
//
// The rule (from the brief): pick the Mock provider UNLESS a real key exists AND
// the real-PHI egress gate is enabled. In this build FEATURE_REAL_PHI_EGRESS is
// false, so this ALWAYS returns the Mock provider. That is the safe default:
//   * no key configured            -> Mock (offline, no spend)
//   * synthetic data mode          -> Mock
//   * real key but gate is false   -> Mock (this build)
//   * real key AND gate true       -> Claude (only possible after operator go-live)
//
// Keeping selection in one tiny function makes the default auditable at a glance.

import { FEATURE_REAL_PHI_EGRESS } from '@shared/constants.js';
import type { DataMode } from '@shared/constants.js';
import type { ModelProvider } from '@shared/types/agent.js';

export interface SelectProviderArgs {
  mock: ModelProvider;
  /** factory for the real provider; called ONLY when selection chooses it, so the
   * SDK is never even constructed in the synthetic/default path. */
  makeReal: () => ModelProvider;
  hasApiKey: boolean;
  dataMode: DataMode;
}

export function selectProvider(args: SelectProviderArgs): ModelProvider {
  const realAllowed =
    FEATURE_REAL_PHI_EGRESS && args.hasApiKey && args.dataMode === 'real';
  return realAllowed ? args.makeReal() : args.mock;
}
