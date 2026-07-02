# Practice Assistant Setup (Claude Desktop plugin)

This page is for the person maintaining the plugin. If you are setting up your practice assistant, read INSTALL.md.

A Claude Desktop plugin that runs a plain-language setup interview for the local-first practice assistant app. The practice app remains the daily driver; this plugin is the concierge that configures it and, on request, creates personal helper skills for workflows the user describes in her own words.

It is built to support the way a practitioner meets her own professional privacy obligations: the interview collects practice setup only (never client details), the practice app's AI stays off unless the user herself turns it on later, and everything lands in local files on her computer. Not a medical device, not a compliance product, and never described as "HIPAA compliant".

## What it does

1. Interview: a bounded, skippable, warm ten-question conversation about how her practice runs, plus an early guided check that her Claude privacy setting "Help Improve Claude" is off. Re-running updates the existing setup and only asks about what she wants to change.
2. Practice Profile: the answers become a validated `practiceProfile` block written into the practice app's `config.json` (see the contract in `skills/practice-setup/references/provisioning-map.md` and the schema in `references/practice-profile.schema.json`).
3. Provisioning: the same guarded writer sets the app's allowed settings: which helpers are on (`app.enabledModules`), note structure, intake fields, scheduling modality, reminder wording, and the practice name. A strict allowlist makes anything else, including anything that could enable AI in the app, structurally unwritable.
4. Helper skills: extra workflows she describes become personal Cowork skills, generated from `references/emitted-skill-template.md` into her Practice Workspace with fixed guardrail lines (no client details; a plain disclosure that Claude conversations are processed by Anthropic under her plan; workspace-scoped; no unrequested web research).

## Layout

```
practice-assistant-setup/
  .claude-plugin/plugin.json        plugin manifest
  INSTALL.md                        plain-language install guide (Windows)
  README.md                         this file
  skills/practice-setup/
    SKILL.md                        the interview skill
    references/interview-guide.md   the conversation, question by question
    references/provisioning-map.md  the file contract with the practice app
    references/practice-profile.schema.json
    references/emitted-skill-template.md
    references/privacy-language.md  single source for all privacy wording
    scripts/write_config.py         guarded, validating, merging settings writer
```

## Safety properties, concretely

- The writer script enforces a strict settings allowlist; `app.dataMode` (the AI switch's plane) and credential-like keys are not on it and are rejected.
- `practiceProfile.provisioning.aiEnabled` must be the literal `false` or the write is refused.
- Existing settings are deep-merged, never clobbered; every write makes a timestamped backup first and lands atomically.
- The only file touched in the app's data folder is `config.json`. The database, sealed keys, and blobs are on an explicit do-not-touch list.
- Emitted helper skills cannot promise sending, scheduling, or background work, and every one opens with the same two guardrail lines.
