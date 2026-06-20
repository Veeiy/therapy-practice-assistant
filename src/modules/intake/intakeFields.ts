// intakeFields: the "config over schema" intake form, the same idea noteFormats.ts
// applies to note sections. The intake form is an ORDERED LIST of FormFieldDef, not
// a hard-coded JSX form. The renderer's SchemaForm reads this list and renders
// inputs; the service reads the same list to decide which values map to known
// intake_record columns and which land in custom_fields_json.
//
// THIS is what lets the therapist "adjust fields to evolving business needs"
// (blueprint hard rule 6) WITHOUT a code rebuild: the list lives in config
// (defaults.ts -> intake.fields) and the user's config.json can override or extend
// it. This file is only the DEFAULT; config wins. A field with a `column` maps to
// that intake_record column; a field with no `column` is stored in custom_fields.

import type { FormFieldDef } from '@shared/types/module.js';

/** The built-in default intake fields. Editable from config without recompiling. */
export const DEFAULT_INTAKE_FIELDS: FormFieldDef[] = [
  {
    key: 'prior_therapy',
    label: 'Prior therapy or counseling',
    type: 'multiline',
    column: 'prior_therapy',
    hint: 'Brief history of previous mental health treatment.',
  },
  {
    key: 'hospitalizations',
    label: 'Hospitalizations',
    type: 'multiline',
    column: 'hospitalizations',
  },
  {
    key: 'current_medications',
    label: 'Current medications',
    type: 'multiline',
    column: 'current_medications',
  },
  {
    key: 'substance_use',
    label: 'Substance use',
    type: 'multiline',
    column: 'substance_use',
  },
  {
    key: 'family_mh_history',
    label: 'Family mental health history',
    type: 'multiline',
    column: 'family_mh_history',
  },
  {
    key: 'consent_acknowledged',
    label: 'Client acknowledged the practice consent form',
    type: 'boolean',
    column: 'consent_acknowledged',
    hint: 'Records that consent was reviewed. This is a checkbox, not a signature.',
  },
];

/** Resolve the active intake field list: config override if present, else the
 * built-in defaults. The service is constructed with this resolver so a config
 * change re-shapes the form with no code change. */
export type IntakeFieldsResolver = () => FormFieldDef[];

/** The set of intake_record columns a config field is ALLOWED to map onto. A field
 * whose `column` is not in this allowlist is treated as a custom field (stored in
 * custom_fields_json), so config can never write to an unexpected column. */
export const KNOWN_INTAKE_COLUMNS = new Set<string>([
  'prior_therapy',
  'hospitalizations',
  'current_medications',
  'substance_use',
  'family_mh_history',
  'consent_acknowledged',
]);
