# Operator guide: building and shipping the Windows installer

This document is for the operator/builder. It covers the steps a macOS
build host CANNOT do, plus the one-time prototype gate that must pass on a real
Windows machine before this app touches a real client's information.

Nothing in this guide moves money, sends data, or flips the real-PHI switch. Those
are deliberate, separate decisions called out at the end.

A note on scope: the app is fully built and the testable core is green on macOS
(28 tests, see the build summary). What remains is genuinely Windows-only:
Authenticode signing, the native module ABI rebuild against Electron, and the
on-Windows runtime smoke test of the spawned `claude.exe`.

---

## 0. Why a Windows host is required

Three things cannot be produced or verified on the macOS build host:

1. **Authenticode code signing.** A signed `.exe` needs a Windows code-signing
   certificate and the Windows signing toolchain. Without a signature, Windows
   SmartScreen shows a scary "unknown publisher" warning on first run. (This is
   operator escalation OP-3.)
2. **Native-module ABI.** `better-sqlite3-multiple-ciphers` is a native addon. On
   macOS `npm install` compiled it for the macOS Node ABI. The shipped Windows app
   needs it compiled for the WINDOWS Electron ABI. That rebuild happens on Windows.
3. **The spawned `claude.exe` smoke test.** The Claude Agent SDK spawns a native
   Windows binary. That it launches cleanly, headless, with no stray console
   window, inside the packaged signed bundle is the one Medium-confidence assumption
   the whole design rests on. It must be confirmed on Windows (Prototype Gate 1).

---

## 1. One-time setup on the Windows host

You need a Windows 10/11 machine (or VM, or Windows CI runner).

1. Install **Node.js 18 LTS or newer** (the same major you tested with is safest).
2. Install **Git** and clone the repo (or copy the `app/` directory over).
3. From the `app/` directory:

   ```
   npm install
   ```

   On Windows this resolves the win32-x64 optional dependency of the SDK naturally,
   so `claude.exe` is present without the macOS bridge script. It also compiles the
   native SQLite module for the host Node ABI.

4. Rebuild the native module against **Electron's** ABI (not host Node's):

   ```
   npx electron-rebuild -f -w better-sqlite3-multiple-ciphers
   ```

   `scripts/rebuild-native.mjs` intentionally does NOT do this automatically (it
   keeps `npm install` fast and keeps the Node-ABI build the test suite uses). This
   is the documented place to run it for the packaged app.

---

## 2. Confirm the win32 SDK binary is present

The Windows app must ship with `claude.exe`. Verify:

```
dir node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe
```

If it is missing (for example if you copied `node_modules` from the Mac), run:

```
npm run force-win32
```

That calls `scripts/force-win32-sdk.cjs`, which force-installs the win32 optional
dependency. `electron-builder` also runs this in its `beforeBuild` hook, so a clean
Windows build does it for you. Building on a real Windows host is the preferred path
precisely because npm gets this right on its own.

---

## 3. Run the test suite on Windows (recommended)

Before packaging, confirm the core still passes on the Windows Node ABI:

```
npm test
```

Expect the same 28 passing tests you saw on macOS. If the native module fails to
load here, fix that before going further (it means the ABI rebuild in step 1.4 did
not take, or Node and the build tools are mismatched).

---

## 4. Prototype Gate 1: the headless SDK smoke test (DO THIS BEFORE SHIPPING)

This is the single most important Windows-only check. It confirms the spawned
`claude.exe` launches cleanly inside the built app.

There is a safe way to do this WITHOUT sending any real data and WITHOUT a BAA:

1. Build the unpacked app (no installer yet):

   ```
   npm run build
   npx electron-builder --win --dir
   ```

   `--dir` produces `release/win-unpacked/` you can run directly.

2. In `release/win-unpacked/`, launch the app by double-clicking the `.exe`.

3. Confirm, on screen and in the logs:
   - the window opens and shows the first-run disclaimer, then the six-screen shell,
   - NO extra black console/terminal window flashes up alongside it,
   - the data-mode badge reads **Demo data**,
   - the Session Notes screen can create a draft, draft with the assistant
     (this uses the offline Mock provider, so it works with no key and no network),
     edit, sign, lock, and add an addendum.

   This exercises the whole spine. The Mock provider path does not spawn
   `claude.exe`, so to specifically gate the SDK binary you additionally:

4. (SDK binary launch check) Temporarily point the runtime at the real provider in a
   THROWAWAY synthetic test, OR run the SDK's own `claude --version` against the
   bundled binary path printed by the runtime's `agent_runtime_ready` log line
   (`claudeBinaryResolved: true`). You are only confirming the binary launches and
   reports a version, headless, with no console window. Do NOT enter a real key and
   do NOT send client data; this gate is about process launch, not about making a
   real call. If `claudeBinaryResolved` is `false`, the asar-unpack path resolution
   needs attention before the real provider could ever work.

If Gate 1 fails (console window appears, binary will not launch from inside the
bundle, or the path does not resolve), stop and resolve it. The fallback documented
in the architecture is a local/offline model, but first confirm the asar-unpack and
the `app.asar` to `app.asar.unpacked` redirect in `src/main/agent/runtime.ts`.

---

## 5. Code signing (operator purchase, OP-3)

To remove the SmartScreen warning you need an **OV or EV code-signing certificate**
(roughly 200 to 500 USD per year; an EV cert clears SmartScreen reputation faster).
This is a purchase, so it was deliberately NOT done in the build run (Tier 1 safety
floor: no money spent).

Once you have the certificate on the Windows host, configure electron-builder to
sign. Do this with environment variables or a local, untracked file. NEVER commit a
certificate or its password, and never paste them into this repo:

```
set CSC_LINK=C:\path\to\your-cert.pfx
set CSC_KEY_PASSWORD=your-cert-password
```

`electron-builder.yml` deliberately contains no certificate or password. It picks up
the standard `CSC_*` environment variables at build time.

---

## 6. Build the signed installer

```
npm run package
```

This runs `electron-vite build` then `electron-builder --win --x64`, producing a
one-click NSIS installer in `release/`. With the `CSC_*` variables set, the
installer and the app `.exe` are Authenticode-signed.

Hand the resulting installer to the end user. Install is a double-click; there is no
terminal step and no manual dependency for her.

---

## 7. First-run, for the end user (what she sees)

1. Double-click the installer. It installs per-user and creates desktop + Start menu
   shortcuts, then launches.
2. The app opens to the **disclaimer screen** (productivity tool, data stays on this
   computer, the assistant is offline/demo-only in this version, make a backup). She
   reads it and clicks "I understand. Continue."
3. The shell opens on **Session Notes** with obviously-fictional demo clients
   (Sam Sample, Pat Placeholder). The badge reads **Demo data**.
4. She can use the whole notes workflow immediately, offline, with no account and no
   key.

The **Settings** screen has an optional API-key field. In this version it is
go-live preparation only: a key entered there is sealed by Windows (DPAPI) and is
NOT used for real client data, because the real-PHI path is gated off. Settings also
has the encrypted backup/restore.

---

## 8. The go-live decisions (NOT done in this build, by design)

These are the doors the build run intentionally left closed. Each is a deliberate
operator action, not a code change to make casually.

1. **Sign the Anthropic BAA on a HIPAA-enabled org** before ANY real client
   information goes to the assistant (escalations OP-1, OP-2). Confirm at setup
   whether your chosen model is a "Covered Model" (which can force a 30-day retention
   window and block zero-data-retention). The app makes no HIPAA-compliance promise
   on its own.
2. **Flip the real-PHI gate.** `FEATURE_REAL_PHI_EGRESS` in
   `src/shared/constants.ts` is `false`. It is the single compile-time switch that
   lets real-mode requests reach the model. Do not flip it until item 1 is done AND
   the F1 lockdown has been reviewed on a real call. When false, the EgressGuard
   refuses every real-mode request, which the tests prove.
3. **Confirm the pinned model.** `PINNED_MODEL` in the same file is the model the SDK
   pins. Confirm the exact go-live model name at BAA setup and update it there.
4. **Buy and configure the code-signing certificate** (section 5).
5. **Stand up the encrypted-backup habit** with the end user. The DB key is bound to
   her Windows profile; without a passphrase backup, a lost or reset machine means
   the data is gone. The backup feature is built and tested; the habit is human.

---

## Quick reference: what each script does

| Script | What it does | Where it runs |
| --- | --- | --- |
| `npm install` | install deps, compile native module for host Node | any host |
| `scripts/rebuild-native.mjs` | postinstall hook; deliberately leaves the Node-ABI build (does not auto electron-rebuild) | any host |
| `npx electron-rebuild ...` | rebuild native module for the Electron ABI | Windows host |
| `npm run force-win32` (`scripts/force-win32-sdk.cjs`) | force-install the win32 `claude.exe` optional dep | macOS bridge / auto in `beforeBuild` |
| `npm test` | run the 28-test vitest suite | any host |
| `npm run build` | electron-vite build of main/preload/renderer | any host |
| `npm run package` | build + electron-builder Windows NSIS installer | Windows host |
| `npm run seed` (`scripts/seed-synthetic.mjs`) | dev-only: materialize demo data into a local DB without the GUI | dev host |
