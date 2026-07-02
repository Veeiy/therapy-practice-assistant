# Provisioning map: how the finished interview becomes app setup

This file is the contract between the setup interview and the practice app. Follow it exactly. Every write goes through `scripts/write_config.py`, which enforces the key allowlist and the profile schema. Never edit app files by hand and never write keys that are not listed here.

## 1. Where the app's settings live

The practice app reads a single settings file called `config.json` in its data folder. On Windows the AUTHORITATIVE data folder is:

1. `%APPDATA%\therapy-practice-assistant\` (authoritative for BOTH the dev run and the installed build; determined from the app's code, which derives this folder from its internal package name)

Only if that folder does not exist, probe one fallback before concluding the app has never run:

2. `%APPDATA%\Therapy Practice Assistant\` (fallback probe ONLY; not expected to exist on current builds. If `config.json` turns up only here, the app's packaging has changed; use this folder for the write and note it for the operator in the closing summary.)

`%APPDATA%` usually means `C:\Users\<her Windows user>\AppData\Roaming`.

Inside a Cowork session you can only reach this folder if the user has CONNECTED it. During setup, ask her to connect the app data folder (the interview guide has the plain-language wording). Once connected, look for `config.json` inside it. Notes:

- If the folder exists but `config.json` does not, that is fine; the app has simply never saved a setting. The script will create it.
- If NEITHER folder exists, the practice app has not been run yet. Ask her to open the practice app once, close it, and then connect the folder. If she does not have the app installed yet, finish the interview anyway, save the completed payload to the Practice Workspace under `handoff/pending-config-payload.json`, and tell her plainly that the app setup will finish the next time she runs setup after installing the app.
- The `practiceProfile` section inside `config.json` IS the Practice Profile. There is no separate profile file. Its shape is defined by `references/practice-profile.schema.json` and validated on every write.
- The app must be CLOSED while writing. If the app is open when a setting is saved inside it, our changes can be overwritten. Ask her to close the practice app before provisioning and reopen it after.

Files in that folder you must NEVER open, read, copy, or modify, because they hold her private practice data and sealed keys: `practice.db`, `db.key.sealed`, `anthropic.key.sealed`, `firstrun.json`, and anything under `blobs\`. The ONLY file this skill touches in the app data folder is `config.json` (plus the timestamped backup the script creates next to it).

## 2. The allowed settings (complete list; nothing else may be written)

| Interview answer | Setting written into config.json | Value |
|---|---|---|
| whole finished interview | `practiceProfile` | the full Practice Profile object per the schema |
| practice name | `app.productName` | the business name, at most 80 characters (the script shortens longer names and says so); if she skipped it, do not write this key |
| computed module set | `app.enabledModules` | array from the rule in section 3 |
| note style | `notes.defaultFormat` | `"SOAP"`, `"DAP"`, or `"BIRP"` ("not sure" means `"DAP"`) |
| custom note structure (concierge only) | `notes.formats` | the app's built-in formats plus her custom format entry, saved with her setup for a future app update; see section 5 for the honest wording |
| intake wanted | `intake.fields` | the full field list built per section 4 (only when intake is enabled) |
| care setting | `scheduling.defaultModality` | `"in_person"` or `"telehealth"` ONLY, never `"both"`; the script rejects `"both"` here. `careSetting` `"both"` stays a profile-level value. When her care setting is both, the Q3 follow-up answer picks which one to write; if she skipped that follow-up too, write `"telehealth"` and tell her in passing that video is the everyday default (only when scheduling is enabled) |
| typical session length | `scheduling.defaultDurationMinutes` | whole number of minutes, 10 to 240; if she skipped, do not write this key (the app already uses 50) (only when scheduling is enabled) |
| reminder wording (concierge only) | `reminders.defaultTemplate` | her personalized reminder text; keep the `{{preferred_name}}`, `{{date}}`, `{{time}}` placeholders; no client identifier may be hard-coded |
| reminder timing (concierge only) | `reminders.leadHours` | whole number of hours before the appointment (1 to 168) |
| billing currency (concierge only, rare) | `billing.currency` | a 3-letter currency code; default `"USD"` already set in the app, so normally do not write it |

Never written, under any circumstances: `app.dataMode`, any key containing `key`, `secret`, `token`, or `api`, and any key not in the table. The script refuses them. AI inside the practice app stays off; nothing in this table can turn it on, and `practiceProfile.provisioning.aiEnabled` is always the literal `false`.

## 3. Which parts of the app get turned on

Start with notes, which is always on, then add from her answers:

```
enabled = ["notes"]
if wantsIntake            -> add "intake"
if wantsScheduling        -> add "scheduling"
if billsInsurance is "insurance" or "both" -> add "billing"
```

Write the result to `app.enabledModules`. On a re-run, recompute the whole array from the updated profile; never append blindly.

## 4. Building the intake field list

Arrays REPLACE in the app's settings, so `intake.fields` must always be written as the COMPLETE list: the six built-in fields first, then any additions. The built-in six, exactly as the app defines them:

```json
[
  { "key": "prior_therapy", "label": "Prior therapy or counseling", "type": "multiline", "column": "prior_therapy", "hint": "Brief history of previous mental health treatment." },
  { "key": "hospitalizations", "label": "Hospitalizations", "type": "multiline", "column": "hospitalizations" },
  { "key": "current_medications", "label": "Current medications", "type": "multiline", "column": "current_medications" },
  { "key": "substance_use", "label": "Substance use", "type": "multiline", "column": "substance_use" },
  { "key": "family_mh_history", "label": "Family mental health history", "type": "multiline", "column": "family_mh_history" },
  { "key": "consent_acknowledged", "label": "Client acknowledged the practice consent form", "type": "boolean", "column": "consent_acknowledged", "hint": "Records that consent was reviewed. This is a checkbox, not a signature." }
]
```

Additions, appended after the built-ins:

- If `careSetting` is `telehealth` or `both`, append:
```json
{ "key": "telehealth_consent", "label": "Telehealth consent reviewed", "type": "boolean", "hint": "Records that the telehealth consent was reviewed together. A checkbox, not a signature." }
```
- If `practiceType` is `couples` or `family`, append:
```json
{ "key": "relationship_context", "label": "Relationship and family context", "type": "multiline", "hint": "Space for how sessions are structured, for example who usually attends." }
```
- Concierge additions she asks for in her own words become further entries. Rules: `key` is lowercase snake_case and unique; `type` is one of `text`, `multiline`, `date`, `boolean`, `select`; a `select` needs an `options` array of `{ "value", "label" }`; NEVER set a `column` on a new field (fields without a `column` are stored safely in the app's flexible custom area); labels and hints must not reference any real client.

## 5. Custom note structure (concierge only)

If she describes her own note structure (her own sections in her own order), write `notes.formats` as the app's three built-in formats plus one extra entry keyed by a short uppercase name she approves (for example `HOUSE`). Each format is an ordered list of `{ "key", "label" }` sections, keys lowercase snake_case. The built-ins to preserve verbatim:

```json
{
  "SOAP": [ {"key":"subjective","label":"Subjective"}, {"key":"objective","label":"Objective"}, {"key":"assessment","label":"Assessment"}, {"key":"plan","label":"Plan"} ],
  "DAP":  [ {"key":"data","label":"Data"}, {"key":"assessment","label":"Assessment"}, {"key":"plan","label":"Plan"} ],
  "BIRP": [ {"key":"behavior","label":"Behavior"}, {"key":"intervention","label":"Intervention"}, {"key":"response","label":"Response"}, {"key":"plan","label":"Plan"} ]
}
```

Important limit, and the honest promise: today the app offers SOAP, DAP, and BIRP when writing a note, and `notes.defaultFormat` may only be one of those three. Her custom structure does NOT appear inside the app yet; it is saved with her setup so a small future app update can turn it on. Say it plainly, for example: "I have saved your structure with your setup. Your app offers its three built-in note styles today, and the person who set this up for you can switch yours on with a small app update." Never tell her the custom structure is selectable inside the app today.

## 6. The Practice Profile bookkeeping block

On every successful provisioning, the profile's `provisioning` block is:

- `enabledModules`: the computed array from section 3
- `appliedConfigs`: short human labels of what was set, one per touched area, for example `{ "notes": "Data-focused notes (DAP)", "intake": "standard intake plus telehealth consent", "scheduling": "video and in person", "app": "named for the practice" }`
- `aiEnabled`: `false` (always; the script rejects anything else)
- `completedAt`: the current time in ISO 8601

`createdAt` is set the FIRST time setup completes and is preserved on every re-run (the script does this automatically).

## 7. How the write actually happens

1. Compose one payload JSON file in the Practice Workspace at `handoff/config-payload.json`. It is a nested object mirroring config.json, containing ONLY keys from section 2, always including the full `practiceProfile`.
2. Run a dry run first and show her nothing technical; just confirm in plain words what will be set:
   `python3 scripts/write_config.py --config-dir "<connected app data folder>" --payload "<workspace>/handoff/config-payload.json" --dry-run`
3. If the dry run reports OK, run the same command without `--dry-run`. The script backs up any existing `config.json` to `config.backup-<timestamp>.json` in the same folder, merges (existing settings she made in the app are preserved unless this payload changes them), validates, and writes atomically.
4. Read back with `--read` and confirm the profile round-trips.
5. If python3 is unavailable in the session, do NOT hand-edit `config.json`. Save the payload to `handoff/pending-config-payload.json` and tell her plainly: nothing finishes on its own; when she runs "set up my practice assistant" again, it will pick up where it left off. Flag it in the closing message. (Cowork sessions come with python3, so this fallback is not expected to be needed.)

## 8. Re-run rules (never wipe, never re-ask everything)

1. Before any questions, run `--read` to fetch the current profile and settings.
2. If a profile exists, greet her as returning, summarize the current setup in two or three friendly lines, and ask what she would like to change. Ask ONLY about the things she names, plus anything the change logically forces (for example turning billing on requires knowing she now bills insurance).
3. Unchanged answers are carried forward from the existing profile into the new payload untouched. `createdAt` is preserved. The whole profile is still written (full object, schema-validated), but its content only changes where she asked.
4. Settings the payload does not mention are left exactly as they are by the merge. Never write an empty or partial profile, and never delete keys.
