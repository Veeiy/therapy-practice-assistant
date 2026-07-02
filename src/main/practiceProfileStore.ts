// practiceProfileStore: a thin accessor over the existing ConfigStore (NOT a new
// persistence engine) for the NON-PHI Practice Profile the companion setup
// plugin writes under the `practiceProfile` config namespace.
//
// The app is the READER: isOnboarded() tells the shell whether setup happened
// (it drives the first-run setup notice), and get() surfaces the profile-driven
// values. save() exists for symmetry and tests; day to day the plugin writes
// the profile straight into the user-override config.json.
//
// Validation mirrors src/shared/schemas/practiceProfile.schema.json, the
// canonical wire contract, WITHOUT adding a schema-validator dependency:
// required keys, enum values, additionalProperties: false, and the load-bearing
// `provisioning.aiEnabled: const false` (AI is never enabled by provisioning).
// A malformed or corrupt profile is treated as absent, exactly like FirstRunStore
// treats a corrupt flag as not-acknowledged: the app falls back to defaults and
// the setup notice shows again. Fail safe, never fail broken.

import type { ConfigStore } from './config/configStore.js';
import type { PracticeProfile } from '@shared/types/practiceProfile.js';
import { DEFAULT_PRACTICE_PROFILE } from '@shared/types/practiceProfile.js';

const NS = 'practiceProfile';

// enum value sets, kept in lockstep with practiceProfile.schema.json
const PRACTICE_TYPES = ['individual', 'couples', 'family', 'group', 'mixed'];
const CARE_SETTINGS = ['in_person', 'telehealth', 'both'];
const NOTE_FORMATS = ['SOAP', 'DAP', 'BIRP'];
const BILLING_POSTURES = ['insurance', 'cash_pay', 'both'];
const WEEKLY_VOLUMES = ['low', 'medium', 'high'];
const AI_COMFORTS = ['keen', 'cautious', 'off_for_now'];
const PRIVACY_POSTURES = ['maximum', 'standard'];
const MODULE_IDS = ['notes', 'intake', 'scheduling', 'billing'];

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'createdAt',
  'practiceName',
  'practiceType',
  'careSetting',
  'noteFormat',
  'billsInsurance',
  'weeklyVolume',
  'wantsIntake',
  'wantsScheduling',
  'aiComfort',
  'privacyPosture',
  'provisioning',
];
const PROVISIONING_KEYS = ['enabledModules', 'appliedConfigs', 'aiEnabled', 'completedAt'];

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function isEnum(v: unknown, allowed: string[]): boolean {
  return typeof v === 'string' && allowed.includes(v);
}

/** Structural validation mirroring practiceProfile.schema.json (draft-07). */
export function validatePracticeProfile(v: unknown): v is PracticeProfile {
  if (!isObject(v)) return false;

  // additionalProperties: false, and every required key present
  const keys = Object.keys(v);
  if (keys.length !== TOP_LEVEL_KEYS.length) return false;
  for (const k of TOP_LEVEL_KEYS) if (!(k in v)) return false;

  if (typeof v.schemaVersion !== 'number' || !Number.isInteger(v.schemaVersion)) return false;
  if (v.schemaVersion < 1) return false;
  if (typeof v.createdAt !== 'string') return false;
  if (typeof v.practiceName !== 'string' || v.practiceName.length > 120) return false;
  if (!isEnum(v.practiceType, PRACTICE_TYPES)) return false;
  if (!isEnum(v.careSetting, CARE_SETTINGS)) return false;
  if (!isEnum(v.noteFormat, NOTE_FORMATS)) return false;
  if (!isEnum(v.billsInsurance, BILLING_POSTURES)) return false;
  if (!isEnum(v.weeklyVolume, WEEKLY_VOLUMES)) return false;
  if (typeof v.wantsIntake !== 'boolean') return false;
  if (typeof v.wantsScheduling !== 'boolean') return false;
  if (!isEnum(v.aiComfort, AI_COMFORTS)) return false;
  if (!isEnum(v.privacyPosture, PRIVACY_POSTURES)) return false;

  const p = v.provisioning;
  if (!isObject(p)) return false;
  const pKeys = Object.keys(p);
  if (pKeys.length !== PROVISIONING_KEYS.length) return false;
  for (const k of PROVISIONING_KEYS) if (!(k in p)) return false;

  const mods = p.enabledModules;
  if (!Array.isArray(mods)) return false;
  if (!mods.every((m) => isEnum(m, MODULE_IDS))) return false;
  if (new Set(mods).size !== mods.length) return false; // uniqueItems

  if (!isObject(p.appliedConfigs)) return false;
  if (!Object.values(p.appliedConfigs).every((x) => typeof x === 'string')) return false;

  // LOAD-BEARING: aiEnabled is the literal false. Provisioning never enables AI.
  if (p.aiEnabled !== false) return false;

  if (p.completedAt !== null && typeof p.completedAt !== 'string') return false;

  return true;
}

export class PracticeProfileStore {
  constructor(private readonly config: ConfigStore) {}

  /** The stored profile, or null if setup has not happened (or the stored value
   * is malformed; a corrupt profile is treated as absent, fail safe). A profile
   * only counts once createdAt is set, so the default preset alone never does. */
  get(): PracticeProfile | null {
    const p = this.config.get<unknown>(NS);
    if (!validatePracticeProfile(p)) return null;
    return p.createdAt ? p : null;
  }

  /** True once a valid profile exists (drives the first-run setup notice). */
  isOnboarded(): boolean {
    return this.get() !== null;
  }

  /** Write the whole profile (validated against the schema rules before write). */
  save(profile: PracticeProfile): void {
    if (!validatePracticeProfile(profile)) {
      const err = new Error('Practice profile is not valid and was not saved.');
      (err as NodeJS.ErrnoException).code = 'PROFILE_INVALID';
      throw err;
    }
    this.config.set(NS, profile); // ConfigStore.set persists 0600 + re-merges
  }

  /** The express-lane / default starting profile. */
  default(): PracticeProfile {
    return structuredClone(DEFAULT_PRACTICE_PROFILE);
  }
}
