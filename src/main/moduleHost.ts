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
}
