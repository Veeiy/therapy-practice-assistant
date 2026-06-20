// disclaimers: the plain-language copy required by hard rule 3 and rule 8.
//
// This is shared (not buried in a component) so the same words appear on the
// first-run screen, in Settings, and in any export footer, and so the wording is
// reviewed in one place. NO em dashes (operator rule 7). It makes three things
// unambiguous to a non-technical user:
//   1. this is a PRODUCTIVITY tool, not a medical device and not legal advice,
//   2. data stays on THIS computer, encrypted, with no cloud account required,
//   3. sending real client information to the AI is OFF and stays off until the
//      practice owner completes a formal agreement (a BAA) with the AI provider.

export const DISCLAIMERS = {
  title: 'Please read before you begin',

  productNature:
    'This program helps you organize your private practice. It is a productivity ' +
    'tool. It is not a medical device, it does not provide medical or clinical ' +
    'advice, and it does not provide legal or billing advice. You remain ' +
    'responsible for every clinical and billing decision.',

  localData:
    'Your information is stored only on this computer, in an encrypted file. The ' +
    'program does not require a cloud account and does not send your client ' +
    'information anywhere by default. There is no usage tracking.',

  aiBoundary:
    'The writing assistant in this version works with demo data only and runs ' +
    'without sending anything over the internet. Using the assistant with real ' +
    'client information is turned off in this version. It can be turned on later ' +
    'only after the practice owner signs a formal privacy agreement, called a ' +
    'Business Associate Agreement (BAA), with the AI provider. This program does ' +
    'not promise HIPAA compliance on its own.',

  backupReminder:
    'Because your data is encrypted and tied to this computer, please create an ' +
    'encrypted backup with a passphrase you will remember. If this computer is ' +
    'lost or reset and you have no backup, the data cannot be recovered.',

  // Wave 3, module C: the billing claims/payment boundary, shown in-app on the
  // billing screen. The app PRODUCES documents the client can self-submit; it
  // never submits a claim and never moves money.
  billingBoundary:
    'This is a productivity tool. It produces an invoice or a superbill that you ' +
    'or your client can submit to insurance. It is not billing or claims software, ' +
    'it does not file insurance claims, and it does not process payments or move ' +
    'money. It is not tax or legal advice. You choose every code and review every ' +
    'amount.',

  // Wave 3, module B: the reminder boundary, shown on the scheduling screen. A
  // reminder is staged and previewed only; nothing is sent in this version.
  reminderBoundary:
    'Reminders are prepared and queued so you can review the exact wording. ' +
    'Nothing is sent automatically in this version. Sending email is a setup step ' +
    'the practice owner completes later. Text message (SMS) reminders are not ' +
    'included yet.',

  acknowledgeButton: 'I understand. Continue.',
} as const;

/** Short one-liners reused as badges / footers. */
export const SHORT_NOTICES = {
  notMedicalDevice: 'Productivity tool. Not a medical device. Not clinical or legal advice.',
  syntheticMode: 'Demo data mode. The assistant is offline and uses fictional records only.',
  realModeBlocked: 'Real client data cannot be sent to the assistant in this version.',
} as const;
