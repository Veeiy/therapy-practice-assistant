// moduleHost: the tiny engine that turns a list of WorkflowModules into a running
// system. This is the heart of the "module = directory + one registry line"
// architecture. The spine builds the modules, hands them here, and the host:
//
//   1. merges every module's defaultConfig into one defaults object (so the
//      ConfigStore can layer user overrides on top),
//   2. registers every module's IPC handlers onto the shared router,
//   3. produces the serializable ModuleDescriptor[] the renderer nav rail uses.
//
// Module migrations are intentionally centralized in 0001_init.sql this build (the
// WorkflowModule.migrations field exists for a future module that owns its own
// SQL), so the host does not run per-module SQL here; the spine's migrator already
// ran the single init migration before modules are hosted.

import type { WorkflowModule, ModuleDescriptor } from '@shared/types/module.js';
import type { IpcRouter } from '@shared/types/ipc.js';

type Json = Record<string, unknown>;

// ── config-driven enablement (custom buildout) ───────────────────────────────
// The spine still BUILDS every module at compile time (unchanged), but only
// HOSTS and ADVERTISES the ones the Practice Profile enabled, via the non-PHI
// config key `app.enabledModules`. The default keeps all four modules on, so an
// un-provisioned install behaves exactly like before.

/** Every module id the registry compiles today. Doubles as the safe fallback. */
export const DEFAULT_ENABLED_MODULES: readonly string[] = [
  'notes',
  'intake',
  'scheduling',
  'billing',
];

/**
 * Sanitize the raw `app.enabledModules` config value into a usable allowlist.
 * A missing or malformed value (not an array of strings) falls back to ALL
 * modules, so a corrupt config can only ever widen, never strand the user.
 * An explicit empty array is honored (the host still keeps notes on).
 */
export function resolveEnabledModules(raw: unknown): string[] {
  if (Array.isArray(raw) && raw.every((x) => typeof x === 'string')) {
    return [...(raw as string[])];
  }
  return [...DEFAULT_ENABLED_MODULES];
}

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(a: Json, b: Json): Json {
  const out: Json = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k] as Json, v) : v;
  }
  return out;
}

export class ModuleHost {
  constructor(private readonly modules: WorkflowModule[]) {}

  /** Merge all modules' defaultConfig into one object (lowest config layer add-on). */
  mergedDefaultConfig(base: Json): Json {
    let out = base;
    for (const m of this.modules) {
      if (m.defaultConfig) out = deepMerge(out, m.defaultConfig);
    }
    return out;
  }

  /** Register every module's IPC handlers onto the shared router. */
  registerAll(router: IpcRouter): void {
    for (const m of this.modules) {
      m.registerIpc?.(router);
    }
  }

  /** The serializable descriptors the renderer uses to build the nav rail. */
  descriptors(): ModuleDescriptor[] {
    return this.modules.map((m) => ({
      id: m.id,
      title: m.title,
      icon: m.icon,
      functional: m.functional,
    }));
  }

  // ── enablement-filtered views (additive; the methods above are untouched) ──

  /** The modules whose id is in the enabled allowlist. 'notes' is always kept
   * (the headline workflow is never disabled). */
  private enabledOnly(enabledIds: string[]): WorkflowModule[] {
    const allow = new Set(enabledIds);
    allow.add('notes'); // notes is always on
    return this.modules.filter((m) => allow.has(m.id));
  }

  /** Register IPC for the enabled modules only. A disabled module's channels are
   * never registered, so no code path can reach it. */
  registerEnabled(router: IpcRouter, enabledIds: string[]): void {
    for (const m of this.enabledOnly(enabledIds)) {
      m.registerIpc?.(router);
    }
  }

  /** Descriptors for the enabled modules only; the nav rail shows nothing else.
   * NOTE: mergedDefaultConfig is intentionally NOT filtered. A disabled module's
   * config defaults staying merged is harmless (nothing reads them while it is
   * off) and keeps re-enabling a pure data change: write the config key, reboot. */
  enabledDescriptors(enabledIds: string[]): ModuleDescriptor[] {
    return this.enabledOnly(enabledIds).map((m) => ({
      id: m.id,
      title: m.title,
      icon: m.icon,
      functional: m.functional,
    }));
  }
}
