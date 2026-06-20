# How this app uses the Claude Agent SDK

This is the main teaching document. It is written for an engineer who knows how to
build software but has not used the Claude Agent SDK before. It teaches the mental model
first, then walks the real code in this repository line by line, so you understand not
just what the app does but why each control exists.

Everything here is grounded in files you can open. The SDK touches exactly one file in
this codebase, on purpose. By the end of this guide you should be able to read that file
with confidence and run the real SDK yourself, safely, with synthetic data.

A note on what this guide does NOT do: it never tells you to send a real client's
information to the cloud. Real-data use is gated and is covered separately in
[operator-go-live-checklist.md](operator-go-live-checklist.md).

---

## 1. The mental-model shift: the SDK spawns a binary, it is not an HTTP client

If you have used the older Anthropic SDKs, you reached the model by constructing a client
object and making HTTPS calls. The **Claude Agent SDK** is different, and this difference
drives almost every packaging and security decision in this app.

The Agent SDK ships a self-contained native `claude` binary as a platform-specific
optional dependency, and `query()` **spawns that binary as a child process**. You are not
new-ing up an HTTP client inside your Node process; you are launching a subprocess that
itself talks to Anthropic. This subprocess-spawn behavior is the model the SDK has used
since version `0.2.113`. The version pinned in `package.json` is `@anthropic-ai/claude-agent-sdk: ^0.3`,
and the version installed in this run resolved to `0.3.179` (you can confirm with
`node -e "console.log(require('@anthropic-ai/claude-agent-sdk/package.json').version)"`).

Two consequences follow directly, and you can see both in the code:

1. **Packaging must extract the binary.** A binary cannot be executed from inside an
   `app.asar` archive, so `electron-builder.yml` marks the whole `@anthropic-ai` tree as
   `asarUnpack`, and `src/main/agent/runtime.ts` rewrites the resolved path from
   `app.asar` to `app.asar.unpacked` so the spawn points at a real file on disk. Section 6
   walks this.
2. **You should pin the binary path.** Rather than letting the SDK find a `claude` on the
   system `PATH` (which might be a different version, or a developer's own install), the
   app passes `pathToClaudeCodeExecutable` so it launches exactly the bundled binary.

Hold onto one sentence: **on this platform, "calling the model" means "launching a
subprocess."** That reframes the whole problem from "is the network reachable" to "is the
right binary in the bundle, can it launch cleanly and headless, and is it locked down so
it cannot do anything except return a Messages-style answer."

### query(), the message loop, and options

The single entry point you will use is `query()`. It is an async generator: you call it
with a prompt and an options object, then iterate the messages it yields with a
`for await ... of` loop. Conceptually:

```ts
for await (const message of query({ prompt, options })) {
  // each message is a step in the conversation: assistant text, tool calls, etc.
}
```

In a normal agentic app you would handle several message types, including tool-use
blocks, across multiple turns. In this app we deliberately reduce that surface to almost
nothing: one turn, no tools, accumulate the assistant text, done. The `options` object is
where you make that reduction real, and in this app **the options object is the security
contract**. That is the heart of section 3.

---

## 2. The one rule that makes the SDK teachable here: a single import, lazily loaded

Open `src/main/agent/providers/claudeAgentSdkProvider.ts`. This is the **only** file in
the entire codebase that imports the SDK. Nothing else does. That is a deliberate design
choice: if you want to understand the SDK in this app, there is exactly one file to read,
and there is nothing hidden anywhere else.

It does not even import the SDK at the top of the file. It imports it lazily, inside the
one method that makes a call:

```ts
// src/main/agent/providers/claudeAgentSdkProvider.ts, inside runQuery()
const { query } = await import('@anthropic-ai/claude-agent-sdk');
```

Why lazy? Two reasons, both load-bearing:

- **Tests never load the SDK.** The vitest suite exercises the data layer, the services,
  the EgressGuard, and the Mock provider. None of those import this file, and because the
  import is inside a method that the tests never call, the SDK is never even loaded during
  testing. The suite runs under plain Node with no Anthropic dependency.
- **The offline default never loads it either.** As you will see in section 5, the
  provider selector returns the Mock provider in this build. The real provider is
  constructed but its `runQuery()` is never reached, so the dynamic import never fires.

The practical lesson for an SDK newcomer: keeping the SDK behind one lazily-imported
module is what lets you build, test, and demo the entire app with no key, no network, and
no spend, and then later flip on the real path without touching any of the workflow code.

---

## 3. A guided read of the F1 lockdown in `buildOptions()`

This is the most important section. Open `claudeAgentSdkProvider.ts` and find
`buildOptions()`. The audit gate for this project required a hardening pass it called
**F1**, and every control of that pass lives in this one function, each with a comment
tying it to the fix. This is what "the options object is the security contract" means: the
options below make the dangerous surfaces unreachable at the process level, not merely
asserted on a request object.

Here is the function, annotated control by control. The app is a PHI-adjacent clinical
tool, so each control is explained in terms of why it matters for that setting.

```ts
private buildOptions(req: EgressRequest, apiKey: string): Record<string, unknown> {
  return {
    // ── pin the model (F1) ──
    model: PINNED_MODEL,

    // ── generic system prompt; PHI-free, already asserted by the guard ──
    systemPrompt: req.system,

    // ── disable ALL tools (F1): no file, web, bash, or code-execution tools ──
    allowedTools: [],
    disallowedTools: ['*'],
    permissionMode: 'plan',

    // ── register NO MCP servers (F1) ──
    mcpServers: {},

    // ── load NO external/project settings (F1) ──
    settingSources: [],

    // ── pin the binary; never resolve 'claude' by PATH ──
    pathToClaudeCodeExecutable: this.deps.pathToClaudeCodeExecutable,

    // ── bound the response ──
    maxTurns: 1,

    // ── env: spread process.env FIRST, then override ──
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: apiKey,
      CLAUDE_DISABLE_PROMPT_CACHING: '1',
      DISABLE_PROMPT_CACHING: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_BUG_COMMAND: '1',
      CI: '1',
    },
  };
}
```

### `allowedTools: []`, `disallowedTools: ['*']`, `permissionMode: 'plan'`

The Agent SDK can, by default, give the model tools: read and write files, run shell
commands, fetch the web, execute code. For a general coding agent that is the point. For a
clinical notes assistant that is a liability you never want. So the app turns tools off
three ways at once, belt and braces:

- `allowedTools: []` is an empty allowlist, so nothing is permitted.
- `disallowedTools: ['*']` explicitly denies everything.
- `permissionMode: 'plan'` puts the engine in a mode that does not execute tools at all.

Any one of these would largely do the job. Using all three means a future SDK default
change, or a single typo, cannot silently re-enable a tool. The model's only possible
output is text.

### `mcpServers: {}`

MCP (Model Context Protocol) servers are how you would plug external capabilities and data
sources into an agent. This app registers none. There is no MCP surface, so there is no
external connector the model could reach through.

### `settingSources: []`

This is a subtle and important one for a newcomer. The spawned `claude` engine can, by
default, load configuration from the developer's own environment: a local Claude config, a
personal tool registry, a personal MCP set. On your machine that might be quite permissive.
`settingSources: []` tells the engine to load **none of that**. The subprocess runs with
only the options this app hands it, not with whatever the person who built the package
happens to have configured locally. Without this, a locked-down call could be silently
widened by an inherited developer setting.

### `pathToClaudeCodeExecutable`

The app passes the absolute path to the bundled, asar-unpacked binary (resolved by the
runtime, section 6). This avoids resolving a `claude` from `PATH`, which could be a
different version or a developer install. You launch exactly the binary you shipped.

### `maxTurns: 1`

The request is a single-shot expansion of clinician shorthand into a note. There is no
multi-step agent loop to run, so the response is bounded to one turn. This also limits cost
and removes any chance of the engine looping.

### `model: PINNED_MODEL`

The model is pinned explicitly to the value of `PINNED_MODEL` from
`src/shared/constants.ts` (currently `claude-3-5-sonnet-latest`). Pinning means nothing
floats to an unintended model. The operator confirms the exact go-live model at BAA setup,
which ties to the Covered Model question in the go-live checklist.

### The `env` block, and the one gotcha worth memorizing

This is the single most surprising thing about the SDK, and the comment in the code calls
it out: **the SDK replaces the subprocess environment rather than merging it.** When you
pass an `env` object, that becomes the child process's environment; it is not layered on
top of the parent's environment.

That has two failure modes if you get it wrong:

- If you pass `env` **without** spreading `process.env` first, you strip the environment
  the binary needs to run at all.
- If you pass overrides but forget the spread, you can also lose inherited values you did
  want, or (depending on what you set) leave a door open. The safe pattern is: spread
  `process.env` first, then set your overrides last so they win.

That is exactly what the code does: `{ ...process.env, ANTHROPIC_API_KEY: apiKey, ... }`.
The overrides that follow the spread all push in the safe direction:

- `CLAUDE_DISABLE_PROMPT_CACHING` and `DISABLE_PROMPT_CACHING`: turn prompt caching off.
  On a PHI-adjacent path you do not want content lingering in a cache.
- `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`:
  turn off analytics, crash reporting, and other non-essential traffic, so the only network
  call the binary makes is the model request itself.
- `DISABLE_AUTOUPDATER`, `DISABLE_BUG_COMMAND`: stop the spawned binary from updating
  itself or offering to download extra components. You ship a known binary and it stays
  that way.
- `CI: '1'`: keep the binary non-interactive (it will not try to prompt).

If you remember one line from this whole guide, remember the env spread. It is the
difference between a locked-down call and an accidentally tool-enabled or self-updating one.

---

## 4. How a draft flows, end to end

Now follow a single "draft this note" action through the whole system. The path is the
same whether the Mock or the real provider is selected, because both go through the same
boundary. The functional workflow is session notes, so that is the example.

```
NotesScreen (renderer)
  -> window.api.notes.requestDraft           (preload bridge, one explicit IPC invoke)
    -> notes module registerIpc handler      (src/modules/notes/index.ts)
      -> NoteService.requestDraft            (src/modules/notes/noteService.ts)
        -> provider.draftNote(input)         (Mock by default; real if selected)
          -> buildNoteDraftRequest(input)    (src/main/agent/providers/buildNoteRequest.ts)
          -> EgressGuard.guard(req)          (src/main/agent/egressGuard.ts)   <-- the chokepoint
          -> [real provider only] query()    (the SDK subprocess, with buildOptions)
          -> parseSectionsFromText(...)      (src/main/agent/providers/parseSections.ts)
          -> stripDashes(...)                (src/main/agent/textPostProcess.ts)  <-- F5
        <- sections returned, saved to the encrypted DB, ai_assisted = true
```

Step by step:

1. **The renderer** (`src/renderer/screens/NotesScreen.tsx`) collects the therapist's
   shorthand and calls `window.api.notes.requestDraft(...)`. The renderer has no database
   access and no SDK access; it can only call the small set of functions on `window.api`
   that the preload bridge exposes.

2. **The preload bridge** (`src/preload/index.ts`) turns that into a single, named
   `ipcRenderer.invoke` on a specific channel. There is no generic passthrough, so the
   renderer cannot invoke an arbitrary channel.

3. **The notes module** (`src/modules/notes/index.ts`) has a thin handler that calls
   `NoteService.requestDraft`. The module is just the plug; the service holds the logic.

4. **The service** (`noteService.ts`) reads the note from the encrypted DB, refuses if the
   note is already signed (immutability), builds a `DraftNoteInput` from the shorthand and
   the format's section list, and calls `provider.draftNote(input)`.

5. **The request builder** (`buildNoteRequest.ts`) converts that input into a generic,
   minimum-necessary `EgressRequest`. This is where the privacy discipline lives: the
   clinician shorthand rides in the message content; the format and section labels are
   instructions; the light cues are booleans and numbers (session number, modality,
   duration, risk flag present), never identifying text. No client name, date of birth,
   contact, or prior note is ever placed here.

6. **The EgressGuard** (`egressGuard.ts`) is the single fail-closed boundary. It runs five
   checks in order and returns a decision. This is the most important safety object in the
   app, so it has its own subsection below.

7. **The real provider only**, if it had been selected, would then call `query()` with the
   locked-down options from section 3, iterate the assistant text out of the message loop,
   and return it. In this build the Mock provider runs instead and composes the draft
   locally with no network.

8. **`parseSectionsFromText`** maps the returned labeled text back into structured
   sections, locally. Parsing locally is itself a privacy choice: no machine-parseable
   schema carrying patient text ever has to cross the boundary.

9. **`stripDashes`** (the F5 post-process) runs on every section body before it is shown or
   saved, deterministically removing any em or en dash. The service runs it again as a
   belt-and-braces pass, so nothing reaches the database with a prohibited dash regardless
   of which provider produced the text.

### The EgressGuard is fail-closed, in code not policy

This is the line that makes "no real PHI leaves this build" a property of the program
rather than a promise. The very first check in `EgressGuard.guard()` is:

```ts
// src/main/agent/egressGuard.ts
if (req.mode === 'real' && !FEATURE_REAL_PHI_EGRESS) {
  this.log.event('egress_blocked', { purpose: req.purpose, reason: 'real_mode_disabled' });
  return {
    allowed: false,
    code: ERROR_CODES.EGRESS_BLOCKED_REAL,
    reason: 'Real client data cannot be sent in this version.',
  };
}
```

`FEATURE_REAL_PHI_EGRESS` is `false` in `src/shared/constants.ts`. So if a request is
tagged `mode: 'real'`, the guard refuses it before any provider can act. The refusal is not
a UI nicety or a documented policy; it is a branch in the one function every model-bound
request must pass through. The other four checks, also worth reading in the file, are:

- **Messages-only**: reject any request that smuggled in a `tools`, `mcpServers`, `files`,
  or `batch` field. The `EgressRequest` type does not even define those fields; this is
  defense against a loosely-typed caller.
- **No PHI in schema**: an optional generic schema may carry section-name keys only; if any
  value looks like content, refuse.
- **Minimum-necessary**: truncate message content to a per-purpose budget (note drafts get
  6000 characters, for example).
- **Redaction backstop**: scrub obvious identifiers (email, phone, SSN, full dates) from
  message content, and log the count, never the content. This is defense in depth, not
  de-identification.

The `egressGuard.test.ts` suite proves all five behaviors, including that the Mock provider
routes through the guard and that a real-mode request is blocked.

---

## 5. Mock versus real: why the offline provider is the default

The app defines one interface, `ModelProvider` (`src/shared/types/agent.ts`), with a single
`draftNote()` method, and two implementations:

- **`MockDraftProvider`** (`src/main/agent/providers/mockDraftProvider.ts`): offline,
  deterministic, no key, no network, no spend. It still builds the request and runs it
  through the EgressGuard (so the offline path exercises the real chokepoint and proves it
  routes correctly), then composes a realistic structured draft from the shorthand locally.
  It even runs the same `stripDashes` pass, so the no-dash invariant holds offline too.
- **`ClaudeAgentSdkProvider`** (`claudeAgentSdkProvider.ts`): the real SDK with the F1
  lockdown from section 3.

The choice between them is made in one tiny, auditable function,
`selectProvider()` (`src/main/agent/providers/providerSelector.ts`):

```ts
export function selectProvider(args: SelectProviderArgs): ModelProvider {
  const realAllowed =
    FEATURE_REAL_PHI_EGRESS && args.hasApiKey && args.dataMode === 'real';
  return realAllowed ? args.makeReal() : args.mock;
}
```

Read the condition carefully, because it is the whole policy in one line. The real provider
is used only if **all three** are true: the compile gate `FEATURE_REAL_PHI_EGRESS` is on,
a real API key is present, and the data mode is `real`. In this build the gate is `false`,
so this function always returns the Mock provider. That is why:

- with no key configured, you get Mock (offline, no spend),
- in synthetic data mode, you get Mock,
- even with a real key present, while the gate is `false`, you get Mock.

Notice also that `makeReal` is a factory that is only called when selection actually
chooses the real provider. So in the default path the SDK provider is not even constructed,
which (combined with the lazy import) is why the SDK never loads.

**What has to change to use the real SDK.** Exactly two things, and they are intentionally
separated so neither happens by accident:

1. A real, sealed Anthropic API key, stored through the Settings screen (which seals it
   with the OS keystore). This alone does nothing, because the gate is still off.
2. Flipping `FEATURE_REAL_PHI_EGRESS` to `true` in `src/shared/constants.ts`, and setting
   the data mode to `real`. This is a deliberate, reviewed go-live action that the
   go-live checklist gates behind a signed Anthropic BAA. It is never a developer
   convenience toggle.

The reason this matters: the key and the gate are deliberately decoupled. Storing a key is
safe go-live preparation. The gate is the actual door, and it is closed in code, proven by
the test suite, and only opened as a reviewed step.

---

## 6. Why packaging has to unpack the binary (the runtime path swap)

This section ties the section 1 mental model to the code that makes it work in a packaged
app. Open `src/main/agent/runtime.ts` and find `resolveClaudeExecutable()`.

In development, the SDK package sits in `node_modules` and its binary is a normal file. In
a packaged Electron app, the app's JavaScript is bundled into an `app.asar` archive. You
cannot execute a binary that lives inside that archive. The fix has two halves that must
agree:

1. **`electron-builder.yml` unpacks the SDK.** It lists `**/node_modules/@anthropic-ai/**`
   (and the native SQLite module) under `asarUnpack`, so at build time those files are
   written to an `app.asar.unpacked` directory on disk instead of being sealed inside the
   archive.

2. **The runtime rewrites the path.** `resolveClaudeExecutable()` resolves the SDK package
   directory (which resolves inside `app.asar`), then does
   `sdkDir.replace('app.asar', 'app.asar.unpacked')` and looks for the binary in a few
   candidate locations (including the `win32-x64` platform package's `claude.exe`). The
   first one that exists wins. If none exists, it returns `null`.

The runtime resolves this path once at startup (a cheap lookup, not a spawn) and logs a
single line:

```ts
// src/main/agent/runtime.ts, in the AgentRuntime constructor
this.deps.log.event('agent_runtime_ready', {
  claudeBinaryResolved: this.claudePath !== null,
});
```

That `claudeBinaryResolved` boolean is your diagnostic. If it is `true`, the asar-unpack
and the path swap worked and the real provider could launch the binary. If it is `false`,
the real provider would fail at call time, and the packaging needs attention before go-live.
On the macOS build host used in this run, the win32 binary is not present (npm installs only
the current platform's optional dependency), so the win32 path resolution is something the
operator confirms on a Windows host. This is exactly the on-Windows prototype gate described
in [OPERATOR-WINDOWS-PACKAGING.md](../OPERATOR-WINDOWS-PACKAGING.md).

One more detail worth knowing: in `electron.vite.config.ts` the SDK and the native SQLite
module are marked `external` so the bundler does not try to inline them. They have to stay
as real on-disk packages precisely so the asar-unpack rule can place the real binaries where
the runtime expects.

---

## 7. How to run the real SDK yourself, safely, with synthetic data

You asked to be taught the SDK, not handed a black box, so here is a safe local path to
actually watch the real provider make a call. Read this section fully before you try it.

**The hard boundary first.** Nothing in this section tells you to send real client
information anywhere. Real client PHI must not be used until the go-live checklist
(BAA, Covered Model confirmation, the reviewed gate flip) is complete. The steps below use
only synthetic, made-up text. Treat the prompt you type as if it were public.

**Where the key goes, and only there.** The one place you ever enter an Anthropic API key
is the **Settings** screen inside the running app. Open Settings, paste a key into the
"AI assistant key" field, and click "Store key." That seals the key with your OS keystore
(`src/main/secure/apiKeyStore.ts`) and writes it as `anthropic.key.sealed` under the
app-data directory. You do not paste a key into any source file, any environment variable,
any config file, or any other field. The app never types your key into an external field
either; it only stores what you typed locally, sealed at rest. If you want to remove it
later, the same screen has "Remove key."

**Why storing a key is not enough (and that is the point).** After you store a key, the app
still uses the Mock provider, because `selectProvider()` also requires
`FEATURE_REAL_PHI_EGRESS` to be true and the data mode to be `real`. So storing a key is a
no-op for behavior; it is just go-live preparation. To actually exercise the real provider
in a local experiment, you would, on a throwaway development build with synthetic data only:

1. Confirm `claudeBinaryResolved: true` in the logs (section 6). On macOS you will likely
   see `false` for the win32 binary; the realistic place to run the real binary end to end
   is a Windows host, which is also where the prototype gate lives.
2. Temporarily set the gate and mode for the experiment, understanding that you are opening
   the door only for synthetic text on your own machine, never for client data. The cleanest
   way to study the call without changing the gate is the alternative the packaging guide
   describes: run the bundled binary's own `claude --version` against the resolved path to
   confirm it launches headless. That proves the subprocess works without making a content
   call at all.
3. If you do make a synthetic content call, type only invented text (for example, "client
   discussed sleep and work stress; practiced breathing; agreed on a sleep log"), and watch
   the `sdk_query_start` and `sdk_query_done` log lines. Note that the provider logs only
   metadata (purpose, model, byte counts), never the prompt or the key.

**What you will learn by doing this.** You will see that the request still passes through
`buildNoteDraftRequest` and the `EgressGuard` exactly as in the Mock path, that the options
from `buildOptions()` are what configure the subprocess, that the message loop yields
assistant text which the provider accumulates, and that `stripDashes` cleans the result.
The workflow code does not change at all between Mock and real; only the provider behind the
`ModelProvider` interface changes. That is the payoff of the whole design.

When you are done experimenting, set the gate back to `false` (its committed state), remove
the synthetic-experiment key if you stored one, and clear any synthetic data you created.
The committed, shipped state of the app is: gate off, Mock provider, offline, no spend.

---

## 8. A short glossary for the newcomer

- **`query()`**: the SDK entry point. An async generator that spawns the `claude`
  subprocess and yields conversation messages you iterate with `for await`.
- **options object**: the configuration you pass to `query()`. In this app it is the
  security contract; see `buildOptions()`.
- **F1 lockdown**: this project's required hardening pass for the SDK call. All of it lives
  in `buildOptions()` plus the data-mode gate in the EgressGuard.
- **EgressGuard**: the single fail-closed boundary every model-bound request passes
  through. Refuses real-mode requests while the feature gate is off.
- **`FEATURE_REAL_PHI_EGRESS`**: the compile-time gate, `false` in this build, that the
  EgressGuard and the provider selector both check.
- **`PINNED_MODEL`**: the explicitly pinned model name, so nothing floats to an unintended
  model.
- **Mock provider**: the offline, deterministic default that needs no key and no network.
- **asar-unpack**: the packaging step that writes the SDK binary to disk outside the
  `app.asar` archive so it can be executed.
- **`claudeBinaryResolved`**: the startup log boolean that tells you whether the binary path
  resolved correctly.

## 9. Where to look next

- Extend the app (config, fields, new modules, note formats):
  [extending-the-app.md](extending-the-app.md).
- Go live with real data (BAA, Covered Model, signing, the gate flip):
  [operator-go-live-checklist.md](operator-go-live-checklist.md).
- Ship the Windows installer and run the prototype gate:
  [OPERATOR-WINDOWS-PACKAGING.md](../OPERATOR-WINDOWS-PACKAGING.md).
