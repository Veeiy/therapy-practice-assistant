# Extending the app

This guide shows how to change the app's behavior and how to add new capability, from the
cheapest change (edit a config value at runtime) to the largest (add a whole new workflow
module). It is grounded in the real files, and it is honest about which changes need a
rebuild and which do not.

Two design principles run through everything here:

- **Config is data, not code.** Where the app is "config-driven," you change behavior by
  editing values, not by editing source.
- **A module is a directory plus one line.** Adding a workflow is meant to be small and
  mechanical, because the schema for all four workflows already ships in one migration.

---

## 1. How config layering works

The config system has two source files and a clear precedence order.

- `src/main/config/defaults.ts` (`APP_DEFAULT_CONFIG`) holds the app-level baked-in
  defaults: the product name, the boot data mode, the note formats, the reminder template,
  the lead time, the billing currency.
- Each workflow module may also contribute a `defaultConfig` object. The `ModuleHost`
  (`src/main/moduleHost.ts`) deep-merges every module's `defaultConfig` on top of the
  app-level defaults to produce the full default object.
- `src/main/config/configStore.ts` (`ConfigStore`) then layers the **user override file**,
  `config.json` in the app-data directory, on top of those merged defaults.

So the resolution order, lowest to highest, is:

```
APP_DEFAULT_CONFIG  (defaults.ts)
  + each module's defaultConfig   (merged by ModuleHost)
    + config.json user overrides  (written when a setting is changed at runtime)
```

Reads use a dotted key. `config.get('reminders.defaultTemplate')` walks the merged object.
Writes go to the override layer only: `config.set('reminders.leadHours', 48)` writes into
`config.json`, persists it, and re-merges, so a change survives a crash and takes effect
without a restart. The store never holds PHI; it is plain JSON.

**Build-time vs runtime, precisely.**

- **Runtime-editable** (no rebuild): anything reachable through `ConfigStore.set`, which is
  surfaced through the `config:set` IPC channel and the Settings screen. The reminder
  template text, the reminder lead hours, the practice/product name, and the intake field
  list (section 2) are all in this category. Editing `config.json` directly while the app
  is closed is also a valid way to change these.
- **Build-time** (needs a rebuild): the compiled defaults in `defaults.ts` and any code,
  including `FEATURE_REAL_PHI_EGRESS`, `PINNED_MODEL`, the database schema, and any new
  field type or service logic. Changing a default in `defaults.ts` only changes the
  fallback for users who have not overridden it; existing `config.json` values still win.

One initialization detail you do not need to fight but should know about: the config store
is built **after** the modules, because the defaults are assembled from each module's
`defaultConfig`. The composition root (`src/main/index.ts`) handles this with a late-bound
`getConfig()` accessor that module services read at call time, by which point boot is done.
You will see this pattern in `src/modules/index.ts`.

---

## 2. Add or change an intake field with no rebuild

The intake form is the clearest example of "config over schema." It is not a hard-coded
JSX form. It is an ordered list of field definitions that both the UI and the service read.

### The moving parts

- `src/shared/types/module.ts` defines `FormFieldDef`: a serializable field description
  with a `key`, a `label`, a `type` (`text`, `multiline`, `date`, `boolean`, or `select`),
  an optional `hint`, an optional `required` flag, optional `select` options, and an
  optional `column`.
- `src/modules/intake/intakeFields.ts` defines `DEFAULT_INTAKE_FIELDS` (the built-in list)
  and `KNOWN_INTAKE_COLUMNS` (the allowlist of real database columns a field may map to).
- `src/renderer/components/SchemaForm.tsx` renders inputs from a `FormFieldDef[]` and
  reports values back by key. It hard-codes no field.
- `src/modules/intake/intakeService.ts` reads the same list to decide where each value is
  stored.

### Where the active list comes from (this is wired through config)

In `src/modules/index.ts`, the intake service is constructed with a `fields` resolver:

```ts
// src/modules/index.ts, inside buildModules()
const intakeService = new IntakeService({
  // ...
  fields: (): FormFieldDef[] =>
    cfg()?.get<FormFieldDef[]>('intake.fields') ?? DEFAULT_INTAKE_FIELDS,
});
```

That resolver means: if `intake.fields` exists in config, use it; otherwise fall back to
the built-in defaults. So you can add, remove, reorder, or relabel intake fields by setting
`intake.fields` in `config.json` (or through the `config:set` channel), with no code change
and no rebuild. The renderer pulls the active list over the `intake:fields` channel and the
`SchemaForm` renders it.

### Where the value lands, and the allowlist that bounds it

Each field's `column` decides storage:

- If `column` is present **and** is in `KNOWN_INTAKE_COLUMNS`, the value is written to that
  real `intake_record` column.
- Otherwise (no `column`, or a `column` not on the allowlist), the value is stored in the
  flexible `custom_fields_json` bag on the intake record.

This allowlist is the safety boundary on a config-driven feature. Config can shape the form
freely, but it can **never** write to an unexpected database column, because a `column`
that is not in `KNOWN_INTAKE_COLUMNS` is treated as a custom field rather than a column
mapping. So a typo or a malicious config value lands harmlessly in the JSON bag instead of
corrupting a typed column.

### Worked example: add a "Preferred pharmacy" field, no rebuild

Add this object to the `intake.fields` array in your `config.json` override (keeping the
existing fields you want):

```json
{
  "key": "preferred_pharmacy",
  "label": "Preferred pharmacy",
  "type": "text",
  "hint": "Optional. Name and location of the client's preferred pharmacy."
}
```

Because `preferred_pharmacy` is not in `KNOWN_INTAKE_COLUMNS`, it is stored in
`custom_fields_json`. The form shows the new input immediately on next launch, no build
required.

### When you DO need a rebuild for an intake field

If you want a new field to live in its **own typed database column** (rather than the JSON
bag), that crosses from config into schema, and schema changes need code:

1. Add a migration `0002_add_intake_preferred_pharmacy.sql` that runs
   `ALTER TABLE intake_record ADD COLUMN preferred_pharmacy TEXT;` (see section 4 on
   migration discipline). Never edit `0001_init.sql`.
2. Add `'preferred_pharmacy'` to `KNOWN_INTAKE_COLUMNS` in `intakeFields.ts`.
3. Give the field `"column": "preferred_pharmacy"` in its definition.

The first two steps are code and need a rebuild; after that, the field mapping is honored.

---

## 3. Add a whole new workflow module

A workflow module is the unit of growth. The four that ship (notes, intake, scheduling,
billing) are each a directory under `src/modules/` plus one line in the registry. Here is
the shape, then a worked sketch.

### The contract

`src/shared/types/module.ts` defines `WorkflowModule`, the entire plug surface:

```ts
export interface WorkflowModule {
  id: 'notes' | 'scheduling' | 'intake' | 'billing' | (string & {});
  title: string;
  icon?: string;
  functional: boolean;            // true once it works end to end; false while scaffolded
  migrations?: string[];          // SQL files this module owns (usually empty; see below)
  registerIpc?(router: IpcRouter): void;   // wire the module's main-process handlers
  defaultConfig?: Record<string, unknown>; // config merged under this module's namespace
}
```

The spine never imports a module's internals. It iterates the registry, merges each
module's `defaultConfig`, registers each module's IPC handlers, and builds the nav rail
from the descriptors. That is the whole integration.

### The registry

`src/modules/index.ts` exports `buildModules(deps)`, which constructs each module's service
from the shared dependencies and returns the array:

```ts
// src/modules/index.ts
return [
  createNotesModule({ service: noteService }),
  createIntakeModule({ service: intakeService }),
  createSchedulingModule({ service: schedulingService }),
  createBillingModule({ service: billingService }),
];
```

Adding a module is: build its service, then add one more line to this array.

### Worked sketch: a hypothetical "Referrals" module

Suppose you want to track outbound referrals to other providers. Here is the shape, mirror-
ing how the existing modules are built. (This is a sketch to follow, not shipped code.)

**1. Data model (a migration, never an edit to 0001).** Create
`src/main/data/migrations/0002_referrals.sql`:

```sql
CREATE TABLE referral (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES client(id),
  referred_to TEXT NOT NULL DEFAULT '',
  reason      TEXT,                      -- PHI free-text lives in body columns only
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','sent','closed')),
  demo        INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_referral_client ON referral(client_id);
```

Register the file in `src/main/data/migrations/index.ts` so the migrator loads it. The
migrator (`src/main/data/migrate.ts`) runs it forward-only, in its own transaction, because
its numeric prefix `0002` is greater than the current `user_version`.

**2. A repository.** Add `src/main/data/repositories/referralsRepository.ts` following the
pattern of the existing repositories (constructor takes the DB plus the injected Clock and
IdGen; methods are plain typed SQL). Expose it from the data store so services can reach it.

**3. A service.** Add `src/modules/referrals/referralsService.ts` holding the workflow logic.
If the workflow ever needs the AI model, take the shared `EgressGuard` as a dependency and
build an `EgressRequest` through it, exactly as the notes flow does. The guard is reachable
from the runtime via `deps.runtime.egressGuard()`.

**4. The module factory + IPC.** Add `src/modules/referrals/index.ts`:

```ts
export function createReferralsModule(deps: { service: ReferralsService }): WorkflowModule {
  return {
    id: 'referrals',
    title: 'Referrals',
    icon: 'referrals',
    functional: true,
    registerIpc(router) {
      router.handle('referrals:list', (req) => deps.service.list(req));
      router.handle('referrals:create', (req) => deps.service.create(req));
      // ...one handler per action
    },
    defaultConfig: { referrals: { /* any editable defaults */ } },
  };
}
```

Add the new channel names to `CHANNELS` in `src/shared/constants.ts` and the typed wrappers
to the preload bridge (`src/preload/index.ts`) and the `RendererApi` type, so the renderer
can call them. The preload bridge has no generic passthrough by design, so a new channel
must be added explicitly there.

**5. The registry line.** In `src/modules/index.ts`, build the service and add one line:

```ts
const referralsService = new ReferralsService({
  referrals: deps.store.referrals,
  audit: deps.store.audit,
  guard,
  dataMode: deps.dataMode,
});
// ...
return [
  createNotesModule({ service: noteService }),
  createIntakeModule({ service: intakeService }),
  createSchedulingModule({ service: schedulingService }),
  createBillingModule({ service: billingService }),
  createReferralsModule({ service: referralsService }),   // the one new line
];
```

**6. A screen.** Add `src/renderer/screens/ReferralsScreen.tsx` and wire it into the shell's
screen routing in `src/renderer/App.tsx`. The nav rail itself is built from the module
descriptors automatically, so the module appears in navigation once it is in the registry.

That is the full extent of adding a workflow: a migration, a repository, a service, a thin
module factory, channel plumbing, a registry line, and a screen. The spine wiring is
untouched.

### A note on `migrations` in the module type

The `WorkflowModule.migrations` field exists so a future module can own its own SQL files.
In this build all schema lives in the single `0001_init.sql` for clarity, and the
`ModuleHost` does not run per-module SQL (the spine's migrator runs the migration directory
before modules are hosted). When you add `0002_referrals.sql`, the simplest path is to
register it in the central migrations index so the spine's migrator applies it, exactly as
above. Use the module's `migrations` field only if you later want a module to carry its SQL
with it.

---

## 4. Migration discipline (do not edit 0001)

The migrator (`src/main/data/migrate.ts`) is forward-only and uses SQLite's
`PRAGMA user_version` as the version counter. Files are named `NNNN_name.sql`; the numeric
prefix is the target version, and a file runs only if its number is greater than the
current `user_version`. Each migration runs in its own transaction and bumps the version
inside that same transaction, so a crash mid-migration cannot half-apply.

The rule that follows: **never edit `0001_init.sql` after it has shipped.** A user who has
already run it has `user_version = 1`, so the migrator will never re-run it, and your edit
would silently never reach their database. Every schema change after the first ship is a
**new** file (`0002_...`, `0003_...`). This keeps every machine's schema reproducible from
the ordered list of migrations.

The existing `0001_init.sql` is worth reading once as a reference for conventions: TEXT
UUID ids, ISO-8601 text timestamps, money as integer cents, booleans as 0/1, a `demo` flag
on seed rows, and the rule that PHI free-text lives only in body/value columns, never in a
column name or enum. It also contains the signed-note immutability triggers, which are a
good example of enforcing an invariant at the storage layer, not just in application code.

---

## 5. Note formats: configs over one schema (and an accuracy note)

Note formats are another "config over schema" example, and they are a useful case study in
reading the code rather than the intent.

`src/modules/notes/noteFormats.ts` defines `NOTE_FORMATS`: SOAP, DAP, and BIRP are three
configs over the **one** `note` schema, each an ordered list of `{ key, label }` sections.
Drafting, editing, signing, locking, and addenda are all format-agnostic; they operate on
whatever sections the chosen format lists. Adding a fourth format (GIRP, PIRP, a custom
house format) is, by design, a config entry of the same shape, not new code or a migration.

The design supports making formats fully config-driven: `defaults.ts` seeds
`notes.formats` from `NOTE_FORMATS`, and `NoteService` accepts an optional
`formatSections` resolver (see `src/modules/notes/noteService.ts`) so the section list can
be backed by the config store.

**The accuracy note, because you should trust the code over any summary:** in the current
wiring, `buildModules` in `src/modules/index.ts` constructs `NoteService` **without**
passing the `formatSections` resolver. So today the notes service falls back to the
built-in `NOTE_FORMATS` map rather than reading `notes.formats` from the config store. The
data shape is config-ready and `defaults.ts` exposes `notes.formats`, but a new or edited
format defined only in `config.json` will not change the running notes UI until the service
is wired to the config resolver (pass a `formatSections` function into the `NoteService`
constructor in `buildModules`, mirroring how the intake service is given its `fields`
resolver). The renderer's format picker in `NotesScreen.tsx` also currently lists SOAP,
DAP, and BIRP explicitly. Treat note formats as "config-shaped and config-ready, but
wired to the built-in default" until that one-line change is made. The intake field path
in section 2, by contrast, IS fully wired through config today, which makes it the better
template to copy when you want a truly no-rebuild change.

---

## 6. Quick reference

| You want to | Change | Rebuild? |
| --- | --- | --- |
| Edit reminder wording, lead time, practice name | `config.json` / Settings (`reminders.*`, `app.productName`) | No |
| Add/edit/reorder an intake field (stored in custom_fields) | `intake.fields` in `config.json` | No |
| Add an intake field with its own typed column | `0002_*.sql` + `KNOWN_INTAKE_COLUMNS` + field `column` | Yes |
| Add a new note format that actually drives the UI | wire `formatSections` resolver into `NoteService`, then `notes.formats` | Yes (one-line wiring) |
| Add a whole new workflow | new dir under `src/modules/` + one registry line + migration + screen | Yes |
| Change the model, the egress gate, or the schema defaults | source in `src/shared` / `src/main` | Yes |
