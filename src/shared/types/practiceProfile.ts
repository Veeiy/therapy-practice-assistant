// The Practice Profile: NON-PHI practice setup metadata produced by the
// companion setup plugin's interview and consumed by the app. Stored in the
// layered ConfigStore under the `practiceProfile` namespace (plain JSON, 0600,
// never PHI). Mirrors the "config over schema" philosophy already used by
// noteFormats and intakeFields.
//
// NONE of these fields is client PHI. They describe the BUSINESS, not any
// patient: practice name (a business name), practice type, care setting,
// format preference, billing posture, rough volume bucket, feature wants, and
// AI/privacy posture. The canonical wire contract is
// src/shared/schemas/practiceProfile.schema.json; the validator in
// PracticeProfileStore enforces the same rules.
//
// The app READS this profile (to know setup happened and to surface profile
// driven values); the WRITER is the setup plugin, which writes the profile into
// the user-override config.json alongside the module config it provisions.

export type PracticeType = 'individual' | 'couples' | 'family' | 'group' | 'mixed';
export type CareSetting = 'in_person' | 'telehealth' | 'both';
export type ProfileNoteFormat = 'SOAP' | 'DAP' | 'BIRP'; // matches domain NoteFormat
export type BillingPosture = 'insurance' | 'cash_pay' | 'both';
export type WeeklyVolume = 'low' | 'medium' | 'high';
export type AiComfort = 'keen' | 'cautious' | 'off_for_now';
export type PrivacyPosture = 'maximum' | 'standard';

/** The id strings must match WorkflowModule.id values in the registry. */
export type ModuleId = 'notes' | 'intake' | 'scheduling' | 'billing';

export interface PracticeProfile {
  /** Schema version for forward-compatible migrations of the profile shape. */
  schemaVersion: number; // default 1
  /** ISO timestamp set when onboarding completes. */
  createdAt: string;

  /** Non-PHI BUSINESS name. Personalizes the UI; names the local workspace.
   * Explicitly NOT a client name. Free text, the only typed onboarding answer. */
  practiceName: string;

  practiceType: PracticeType; // -> intake field defaults + note tone copy
  careSetting: CareSetting; // -> telehealth consent fields + scheduling default modality
  noteFormat: ProfileNoteFormat; // -> notes.* config; DEFAULT 'DAP' when user picks "not sure"
  billsInsurance: BillingPosture; // -> billing module enabled unless 'cash_pay'
  weeklyVolume: WeeklyVolume; // -> informational only; no risky behavior; downstream signal

  wantsIntake: boolean; // -> intake module enabled
  wantsScheduling: boolean; // -> scheduling module enabled
  // notes is ALWAYS enabled (not a field); billing is DERIVED from billsInsurance.

  aiComfort: AiComfort; // -> AI-posture COPY only. NEVER enables AI.
  privacyPosture: PrivacyPosture; // -> local-first framing. DEFAULT 'maximum'.

  /** Written by the provisioning side for idempotency, audit, and display.
   * Contains NO PHI: module ids, config labels, booleans, timestamps only. */
  provisioning: {
    enabledModules: ModuleId[]; // the set written to config app.enabledModules
    appliedConfigs: Record<string, string>; // moduleId -> human label of what was applied
    aiEnabled: false; // LITERAL false. AI is off at provisioning, ALWAYS. Never true here.
    completedAt: string | null; // ISO when provisioning finished; null until done
  };
}

/** The default profile used before onboarding and as the "express lane" preset:
 * a typical solo practice with conservative defaults. Note createdAt is empty,
 * so this default alone never counts as "setup happened". */
export const DEFAULT_PRACTICE_PROFILE: PracticeProfile = {
  schemaVersion: 1,
  createdAt: '', // set at completion
  practiceName: '',
  practiceType: 'individual',
  careSetting: 'both',
  noteFormat: 'DAP', // conservative, simple, common
  billsInsurance: 'cash_pay', // safest default: billing OFF unless chosen
  weeklyVolume: 'medium',
  wantsIntake: true,
  wantsScheduling: true,
  aiComfort: 'off_for_now', // AI off; most conservative posture
  privacyPosture: 'maximum',
  provisioning: {
    enabledModules: ['notes', 'intake', 'scheduling'],
    appliedConfigs: {},
    aiEnabled: false,
    completedAt: null,
  },
};
