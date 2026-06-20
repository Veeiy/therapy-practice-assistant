# Therapy Practice Assistant

A local-first, offline-by-default practice assistant for a solo therapist. It helps
with session notes, intake, scheduling, and simple billing documents. Everything is
stored encrypted on one computer. There is no cloud account, and by default nothing
about a client is sent over the internet.

This README is the front door. If you are new to the codebase, read it top to bottom,
then jump to the guide you need from the table at the end.

## What this is (and is not)

This program is a productivity tool. It is not a medical device, it does not provide
clinical, legal, or billing advice, and it does not by itself make a practice HIPAA
compliant. The person using it remains responsible for every clinical and billing
decision. Using the writing assistant with real client information is turned off in
this build and stays off until a deliberate, reviewed go-live step is completed (see
[docs/operator-go-live-checklist.md](docs/operator-go-live-checklist.md)).

## Architecture in one paragraph

It is an Electron desktop app with three processes that never trust each other more
than they must. The **main process** (`src/main`) owns all data, secrets, and the one
path to the AI model. The **preload bridge** (`src/preload/index.ts`) exposes a small,
explicit, typed `window.api` to the renderer and nothing else (no Node, no database,
no SDK). The **React renderer** (`src/renderer`) is the UI and talks only through that
bridge. On top of that sits a **spine plus four workflow modules**: the spine is the
boot/composition root, the encrypted store, the config layer, the IPC router, and the
agent runtime; each workflow (notes, intake, scheduling, billing) is a directory under
`src/modules` plus one line in the module registry (`src/modules/index.ts`). The single
place that can reach the Anthropic model is the `EgressGuard`
(`src/main/agent/egressGuard.ts`), and the single file that imports the Claude Agent SDK
is `src/main/agent/providers/claudeAgentSdkProvider.ts`.

## Install and run (development)

You need Node.js 18 or newer. From the `app/` directory:

```
npm install      # install dependencies, compile the native SQLite module for host Node
npm run dev      # launch the app in development (electron-vite dev)
```

`npm run dev` opens the Electron window with hot reload for the renderer. The app boots
in **demo (synthetic) data mode** with obviously fictional clients, and the writing
assistant runs offline through a built-in Mock provider, so it works with no API key and
no network.

Note on the native module: `npm install` builds `better-sqlite3-multiple-ciphers`
against your host Node ABI, which is what the test suite uses. The packaged Windows app
needs it rebuilt against Electron's ABI. That is an operator step on a Windows host, not
part of `npm run dev`. See [OPERATOR-WINDOWS-PACKAGING.md](OPERATOR-WINDOWS-PACKAGING.md).

## Run the tests and typecheck

```
npm test         # run the vitest suite once (data layer, services, EgressGuard, providers)
npm run test:watch   # the same suite in watch mode
npm run typecheck    # tsc --noEmit, strict
```

The tests deliberately run under plain Node with no Electron and no network. The
Electron-only pieces (the OS keystore, the browser window) sit behind interfaces and are
not imported by tests, which is why the data and agent layers are fully testable offline.
The suite lives in `test/unit` and `test/integration`. Run it to see the current pass
count on your machine rather than trusting a number written down here.

## Where the data lives

All per-user data is written under the OS app-data directory
(`app.getPath('userData')`, which on Windows is `%APPDATA%/<appId>`), never next to the
executable. The exact layout is defined in `src/main/paths.ts`:

| File | What it is |
| --- | --- |
| `practice.db` | the encrypted SQLite database (whole-database AES-256) |
| `db.key.sealed` | the database key, sealed by the OS keystore (DPAPI on Windows) |
| `anthropic.key.sealed` | the Anthropic API key, sealed the same way (go-live prep only) |
| `config.json` | layered config overrides, non-PHI |
| `firstrun.json` | the first-run disclaimer acknowledgement flag, non-PHI |
| `blobs/` | encrypted attachment blobs |

The database key is generated on first run and sealed to the Windows login, so there is
no passphrase to remember day to day. Because that key is machine-bound, the encrypted
passphrase backup (Settings, and `src/main/data/backup.ts`) is the recovery path if the
machine is lost or reset.

## Documentation map

| Guide | Read it for |
| --- | --- |
| [docs/claude-agent-sdk-guide.md](docs/claude-agent-sdk-guide.md) | how this app uses the Claude Agent SDK, the F1 lockdown, how a draft flows end to end, Mock vs real provider, and how to safely run the real SDK yourself with synthetic data |
| [docs/extending-the-app.md](docs/extending-the-app.md) | the config layer, adding or changing an intake field with no rebuild, adding a whole new workflow module, and note formats as configs |
| [docs/operator-go-live-checklist.md](docs/operator-go-live-checklist.md) | the gated, ordered path to real client data: BAA framing, Covered Model confirmation, code signing, the technical flip, and a real-data readiness checklist |
| [OPERATOR-WINDOWS-PACKAGING.md](OPERATOR-WINDOWS-PACKAGING.md) | building and shipping the signed Windows installer, and the on-Windows prototype gate (already written; the guides above cross-link to it rather than repeat it) |

## Repository layout (orientation)

```
src/
  main/                 the Electron main process (the spine)
    agent/              the agent runtime: EgressGuard, providers, prompt library, post-process
      providers/        Mock + the one real SDK provider, request builder, section parser
    config/             layered config store + baked-in defaults
    data/               encrypted DB open, key manager, migrations, repositories, backup
    secure/             OS-keystore sealing for the DB key and the API key
    ipc/                the main-process IPC router and shell handlers
    paths.ts            where everything is written on disk
    firstRun.ts         the disclaimer acknowledgement flag
    index.ts            the composition root (bootSpine + the BrowserWindow)
  preload/index.ts      the only renderer-to-main bridge (window.api)
  renderer/             the React UI (shell, screens, the reusable SchemaForm)
  modules/              the four workflow modules + the registry (index.ts)
  shared/               types and constants imported by both main and renderer
test/                   vitest unit + integration tests
scripts/                packaging helpers (force-win32, rebuild-native, seed-synthetic)
```

## License

Released under the MIT License (see [LICENSE](LICENSE)). You are free to use, modify,
and distribute it, including for your own practice. It is provided as is, with no
warranty, and nothing here makes a practice HIPAA compliant on its own; see the
"What this is (and is not)" section above and the go-live checklist before using it
with real client information.
