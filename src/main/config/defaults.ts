// defaults: the baked-in default config (hard rule 6 / F7).
//
// This is the LOWEST config layer. Each workflow module also contributes its
// defaultConfig, which the module host merges on top of these app-level defaults;
// the user's config.json then overrides the result. Nothing here is PHI.
//
// F7 (reminder template config LOCATION): the default reminder template text lives
// here, under `reminders.defaultTemplate`, so the operator/fiance can edit the
// wording from Settings without a rebuild. The reminders WORKFLOW that sends them
// is next wave; this run establishes WHERE the text lives and seeds neutral copy.

import { NOTE_FORMATS } from '@modules/notes/noteFormats.js';

export const APP_DEFAULT_CONFIG: Record<string, unknown> = {
  app: {
    // shown in the title bar / about; not PHI
    productName: 'Therapy Practice Assistant',
    // the data mode the app boots in. 'synthetic' is the only supported mode this
    // build; 'real' requires the operator go-live (BAA + feature gate) first.
    dataMode: 'synthetic',
    // which compiled modules are hosted and shown (custom buildout). The default
    // seeds ALL modules, so behavior is identical to before until the companion
    // setup plugin writes a narrower set. Notes is always kept on regardless.
    enabledModules: ['notes', 'intake', 'scheduling', 'billing'],
  },

  notes: {
    // the available note formats (one-schema-three-configs). Editable: adding a
    // fourth format here makes it selectable with no code change.
    formats: NOTE_FORMATS,
    // default signature label used when signing (the practitioner's display name).
    defaultSignedBy: 'Therapist',
  },

  // F7: reminder template lives here so the wording is editable from Settings.
  // The SENDING workflow is next wave; this is the config location + neutral seed.
  reminders: {
    // {{...}} placeholders are filled by the (future) reminder workflow from
    // appointment fields. No client identifier is hard-coded here.
    defaultTemplate:
      'Hello {{preferred_name}}, this is a reminder of your appointment on ' +
      '{{date}} at {{time}}. Reply to this email if you need to reschedule. ' +
      'Thank you.',
    // how many hours before the appointment the reminder is scheduled.
    leadHours: 24,
    // the single supported channel this build (F4 one canonical reminder model).
    channel: 'email',
  },

  billing: {
    // money is integer cents everywhere; this is just the display currency.
    currency: 'USD',
  },
};
