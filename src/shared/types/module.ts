// The three module contracts. This is the ENTIRE plug surface a workflow module
// exposes to the spine (architecture section 2). A module is a directory plus one
// line in src/modules/index.ts. The spine iterates the registry, runs each
// module's migrations, registers its IPC handlers and tools, and merges its
// default config. The spine never imports a module directly.

import type { IpcRouter } from './ipc.js';

/** Describes a workflow module to the shell and the spine. */
export interface WorkflowModule {
  id: 'notes' | 'scheduling' | 'intake' | 'billing' | (string & {});
  title: string;
  /** nav rail icon name (renderer maps it to a glyph). */
  icon?: string;
  /** true once the module is functional end-to-end; false while scaffolded. */
  functional: boolean;
  /** SQL migration file names this module owns (run by the spine's migrator).
   * In this build all migrations live in one 0001_init.sql for clarity, so this
   * is usually empty; the field exists so a future module can own its own SQL. */
  migrations?: string[];
  /** register the module's main-process IPC handlers. */
  registerIpc?(router: IpcRouter): void;
  /** seed config merged into the config store under this module's namespace. */
  defaultConfig?: Record<string, unknown>;
}

/** A descriptor the renderer shell uses to build the nav rail. Serializable
 * (no functions) so it can cross the IPC boundary. */
export interface ModuleDescriptor {
  id: string;
  title: string;
  icon?: string;
  functional: boolean;
}

// ── config-driven forms (Wave 3) ──────────────────────────────────────────────
// A FormFieldDef is the "config over schema" unit that lets a therapist add or
// remove form fields WITHOUT a code rebuild (blueprint hard rule 6). It is the
// same idea as noteFormats' {key,label}: the renderer's SchemaForm reads an array
// of these and renders inputs; services read the same array to know which keys to
// persist. Definitions live in config (defaults.ts + the module's defaultConfig),
// so editing the array in config changes the form with no recompile.
//
// It is fully serializable so it crosses the IPC boundary to the renderer.
export type FormFieldType = 'text' | 'multiline' | 'date' | 'boolean' | 'select';

export interface FormFieldDef {
  /** stable key the value is stored under (in a *_json column or a mapped column). */
  key: string;
  /** human label shown above the input. */
  label: string;
  /** which input to render. */
  type: FormFieldType;
  /** help text under the input (optional). */
  hint?: string;
  /** required for validation (renderer + service both honor it). */
  required?: boolean;
  /** options for a 'select' field. */
  options?: { value: string; label: string }[];
  /** for the built-in intake columns, the column this maps to; if absent the value
   * is stored in custom_fields_json. This is what lets config-defined fields land
   * either in a known column or in the flexible custom_fields bag. */
  column?: string;
}
