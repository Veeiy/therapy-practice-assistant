// configStore: layered, config-driven extensibility (hard rule 6).
//
// The therapist's fiance can adjust behaviour (which note formats exist, which
// reminder template text, custom field lists) WITHOUT a rebuild, because config is
// data, not code. Resolution is a simple three-layer merge, lowest to highest:
//
//   1. DEFAULTS         baked-in defaults, including each module's defaultConfig
//   2. user overrides   config.json in userData (what the app writes when she edits
//                       a setting)
//
// A key is dotted ("notes.formats", "reminders.defaultTemplate"). get() walks the
// merged object; set() writes into the user-override layer and persists it. The
// store NEVER holds PHI; it is plain JSON on disk (non-PHI config only).
//
// This is deliberately small and synchronous. It is loaded once at startup and
// kept in memory; set() writes through to disk so a crash cannot lose a setting.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge source onto target (objects merge, scalars/arrays replace). */
function deepMerge(target: Json, source: Json): Json {
  const out: Json = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (isObject(v) && isObject(out[k])) {
      out[k] = deepMerge(out[k] as Json, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface ConfigStoreOptions {
  /** baked-in defaults (the merged module defaults live here). */
  defaults: Json;
  /** path to the user-override config.json. */
  configPath: string;
}

export class ConfigStore {
  private defaults: Json;
  private overrides: Json;
  private merged: Json;

  constructor(private readonly opts: ConfigStoreOptions) {
    this.defaults = opts.defaults;
    this.overrides = this.load();
    this.merged = deepMerge(this.defaults, this.overrides);
  }

  private load(): Json {
    try {
      if (existsSync(this.opts.configPath)) {
        return JSON.parse(readFileSync(this.opts.configPath, 'utf8')) as Json;
      }
    } catch {
      // a corrupt overrides file should not brick the app; fall back to defaults
    }
    return {};
  }

  private persist(): void {
    mkdirSync(dirname(this.opts.configPath), { recursive: true });
    writeFileSync(this.opts.configPath, JSON.stringify(this.overrides, null, 2), {
      mode: 0o600,
    });
  }

  /** Read a dotted key from the merged config. Returns undefined if absent. */
  get<T = unknown>(key: string): T | undefined {
    const parts = key.split('.');
    let cur: unknown = this.merged;
    for (const p of parts) {
      if (!isObject(cur)) return undefined;
      cur = cur[p];
    }
    return cur as T | undefined;
  }

  /** The whole merged config (for the renderer's settings screen). */
  all(): Json {
    return this.merged;
  }

  /** Write a dotted key into the user-override layer and persist + re-merge. */
  set(key: string, value: unknown): void {
    const parts = key.split('.');
    let cur = this.overrides;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!isObject(cur[p])) cur[p] = {};
      cur = cur[p] as Json;
    }
    cur[parts[parts.length - 1]] = value;
    this.persist();
    this.merged = deepMerge(this.defaults, this.overrides);
  }
}
