# Operator go-live checklist

This is the gated, ordered path from the shipped demo build to a build that may
handle one therapist's real client information through the writing assistant. It is
written for the operator (the person setting up and standing behind the practice),
not for an end user clicking around the app.

Read this in full before you change anything. Nothing here is a developer
convenience. Every step is a deliberate decision with a real-world consequence, and
the steps are ordered on purpose: the paperwork and the model confirmation come
before the technical flip, and the technical flip comes before any real client
information is ever typed into the assistant.

## Plain disclaimer (read this first)

This app is a productivity tool. It is not a medical device, it does not provide
clinical, medical, legal, billing, or tax advice, and **it does not by itself make a
practice HIPAA compliant.** Completing every step on this page does not make you
compliant either. These steps are the technical and contractual preconditions that
let you *consider* turning the feature on; the clinical, legal, and compliance
judgment remains entirely yours, and you may want your own counsel. The app's own
words say the same thing, in `src/shared/disclaimers.ts`:

> This program helps you organize your private practice. It is a productivity tool.
> It is not a medical device, it does not provide medical or clinical advice, and it
> does not provide legal or billing advice. You remain responsible for every clinical
> and billing decision.

> The writing assistant in this version works with demo data only and runs without
> sending anything over the internet. Using the assistant with real client
> information is turned off in this version. It can be turned on later only after the
> practice owner signs a formal privacy agreement, called a Business Associate
> Agreement (BAA), with the AI provider. This program does not promise HIPAA
> compliance on its own.

## What "go live" actually means here

In the shipped build, the writing assistant runs **offline against an in-process
Mock provider** with obviously fictional demo clients. No client information leaves
the computer, because nothing is sent anywhere at all. "Go live" means two distinct
changes happen together:

1. The runtime is allowed to call the **real Anthropic model** (a real network call,
   through the locked-down Claude Agent SDK described in
   [claude-agent-sdk-guide.md](claude-agent-sdk-guide.md)).
2. That call is allowed to carry **real client information** instead of synthetic
   demo data.

The app is built so that neither can happen by accident. The single chokepoint, the
`EgressGuard` (`src/main/agent/egressGuard.ts`), refuses every real-mode request
while the feature flag is off, and the test suite proves it. So the checklist below
is really "how to safely, deliberately, and in the right order, take the guard off."

---

## Step OP-1: Sign an Anthropic BAA on a HIPAA-enabled organization

A Business Associate Agreement (BAA) is the contract that lets a vendor process
protected health information on your behalf. **You sign this before any real client
information ever reaches the model.** Not after a trial run, not "once it's working"
with one real note. Before.

The corrected framing for this build (it matters, because older guidance floating
around the internet is now out of date):

- The **first-party Anthropic API path is the primary path.** You sign a BAA with
  Anthropic on a HIPAA-enabled organization, and that BAA is what covers PHI sent to
  the API. This app uses that first-party path; it does not route through a third
  party.
- Signing the BAA **removes the older mandatory zero-data-retention (ZDR)
  requirement.** ZDR is now *optional*, not a precondition. Do not architect around a
  hard ZDR assumption.
- ZDR may in fact be **incompatible with some models**, so treating it as mandatory
  can paint you into a corner. Decide on retention as a deliberate choice at BAA
  setup, not as an inherited default.

Outcome of this step: a countersigned BAA, on the correct (HIPAA-enabled)
organization, that you can point to.

## Step OP-2: Confirm your model is a "Covered Model"

At BAA setup, **confirm directly with Anthropic whether the specific model you intend
to use is a "Covered Model" under your BAA.** Do not assume. The set of covered
models is not something this build can verify for you, and it can change, which is
exactly why it is a live confirmation with the vendor rather than a value hard-coded
in the repo.

Two practical consequences to ask about explicitly:

- Whether the chosen model being a Covered Model implies a **retention window** (for
  example, a 30-day window) that you must be comfortable with and able to explain.
- Whether your desired retention posture (including ZDR, if you want it) is even
  **available for that model**, given the point above.

The model the app pins by default is in `src/shared/constants.ts`:

```ts
export const PINNED_MODEL = 'claude-3-5-sonnet-latest';
```

If your confirmed go-live model differs from that string, change it **there**, in one
place, as part of this step. The SDK provider pins exactly this value, so the pinned
model and your BAA-confirmed model must match before you go further.

> Why pin at all: pinning the model means a future default change on the vendor side
> cannot silently move your traffic to a model your BAA does not cover. The pin is a
> safety property, not a limitation.

## Step OP-3: Buy and configure a code-signing certificate

This step is about the Windows installer the end user actually runs, not about PHI,
but it belongs in the go-live path because shipping an unsigned build to a real
clinician is its own risk (SmartScreen warnings, tampering, "is this safe to open").

- Obtain an **OV or EV code-signing certificate** (organization-validated or
  extended-validation). Budget roughly **200 to 500 USD per year** depending on type
  and vendor.
- This certificate is **not purchased in this build by design.** Buying a certificate
  and entering its credentials is a real financial and secret-handling action that is
  outside what this run will do for you. It is yours to complete.
- The mechanics (where the cert and its password are read from, why
  `electron-builder.yml` deliberately contains no certificate or password, the
  on-Windows native-module ABI rebuild, and the smoke test on a clean Windows VM) are
  documented once in
  [../OPERATOR-WINDOWS-PACKAGING.md](../OPERATOR-WINDOWS-PACKAGING.md), section 5 for
  signing and section 8 for the go-live decisions. This checklist intentionally does
  not duplicate those instructions; follow them there.

Outcome of this step: a signed installer that installs cleanly on a clean Windows
machine without a SmartScreen block, verified by actually installing it on one.

---

## The technical flip (do this only after OP-1 and OP-2)

There is exactly one compile-time switch that lets a real-mode request reach the
model. It lives in `src/shared/constants.ts`:

```ts
export const FEATURE_REAL_PHI_EGRESS = false as const;
```

While this is `false`, the `EgressGuard` refuses **every** real-mode request as its
very first check, before any prompt is built and before the SDK is ever touched.
That refusal is fail-closed and is covered by the test suite
(`test/unit/egressGuard.test.ts`). This is the property that makes the demo build
safe to hand to anyone.

Flipping it to `true` is **a deliberate, reviewed go-live action**, and it is only
valid when **all** of the following are already true:

- OP-1 is done: a countersigned Anthropic BAA on a HIPAA-enabled org exists.
- OP-2 is done: your go-live model is confirmed a Covered Model, you accept its
  retention posture, and `PINNED_MODEL` matches it.
- A **real sealed Anthropic API key** has been added through the app's **Settings**
  screen, which seals it to the OS keystore (`anthropic.key.sealed`). The key is
  entered by the operator, in Settings, and nowhere else. Never paste a key into a
  source file, an environment file committed to the repo, or any other field. See the
  synthetic-only experiment section of
  [claude-agent-sdk-guide.md](claude-agent-sdk-guide.md) for how the key path works.
- The F1 SDK lockdown in `buildOptions()` has been **re-reviewed against a single
  real call** with synthetic data (empty allowedTools, `disallowedTools: ['*']`,
  `permissionMode: 'plan'`, no MCP servers, `maxTurns: 1`, the pinned model, and the
  env-spread behavior), so you have watched the locked-down call behave on the wire,
  not just in the Mock.

Only when every one of those holds do you change the flag. Treat the flip as a
checklist gate, not an edit. After flipping, the EgressGuard's remaining checks
(messages-shaped payloads only, no raw schema values, the pinned model) still apply
on every request; the flip removes only the blanket real-mode refusal, not the rest
of the guard.

> One file, one line, two preconditions, one re-review. If you cannot point to the
> signed BAA and the Covered Model confirmation, the flag stays `false`.

---

## Real-data readiness checklist

Run this as a literal checklist. Do not start it until OP-1 through OP-3 and the
technical-flip preconditions above are genuinely satisfied. Anything you cannot check
is a reason to stop.

### Contracts and model
- [ ] Anthropic BAA is countersigned and on a **HIPAA-enabled** organization (OP-1).
- [ ] You have confirmed **with Anthropic** that your exact model is a **Covered
      Model** (OP-2).
- [ ] You understand and accept the retention posture for that model (for example, a
      30-day window), and you know whether ZDR is available and whether you want it.
- [ ] `PINNED_MODEL` in `src/shared/constants.ts` matches the BAA-confirmed model
      name exactly.

### Build and distribution
- [ ] An **OV or EV code-signing certificate** is purchased and configured on the
      Windows host (OP-3), with credentials supplied out-of-band, never in the repo.
- [ ] The native SQLite module has been rebuilt against **Electron's ABI** on the
      Windows host (see [../OPERATOR-WINDOWS-PACKAGING.md](../OPERATOR-WINDOWS-PACKAGING.md)).
- [ ] The signed installer has been **installed and launched on a clean Windows
      machine** with no SmartScreen block, and the app boots.

### The technical flip and the key
- [ ] A real Anthropic API key has been entered **only through Settings** and is
      sealed (`anthropic.key.sealed` exists); the key appears in no source or config
      file.
- [ ] The **F1 SDK lockdown** has been re-reviewed against one real call with
      synthetic data, and the `claudeBinaryResolved` diagnostic confirms the SDK is
      driving the intended pinned binary.
- [ ] `FEATURE_REAL_PHI_EGRESS` is flipped to `true` **only after** every box above
      is checked, as a reviewed change, not a casual edit.
- [ ] The `EgressGuard` tests still pass after the flip, and a synthetic real-mode
      request now succeeds end to end while a malformed one is still refused.

### Operations and recovery
- [ ] The end user has been walked through the **encrypted-backup habit** (Settings,
      and `src/main/data/backup.ts`): an encrypted backup with a passphrase she will
      remember exists, because the DB key is bound to her Windows profile and a lost
      or reset machine with no backup means the data is unrecoverable.
- [ ] The end user has read and acknowledged the first-run disclaimers, and
      understands the assistant produces **drafts she reviews**, never final clinical
      or billing decisions.
- [ ] You have a plan for what happens if the assistant is wrong: the human signs,
      the human bills, the human is responsible.

---

## What this checklist does not do

It does not make you HIPAA compliant. It does not constitute legal, clinical, or
compliance advice. It does not transact, sign anything, buy anything, or send any
real client information on your behalf; those are your actions to take, in the world,
with your eyes open. It gets the software to the line. You decide whether to cross
it.

## See also

- [README.md](../README.md) for the front-door overview and where data lives.
- [claude-agent-sdk-guide.md](claude-agent-sdk-guide.md) for the F1 lockdown, the
  Mock-versus-real provider selector, the sealed-key path, and how to run the real
  SDK safely with synthetic data.
- [../OPERATOR-WINDOWS-PACKAGING.md](../OPERATOR-WINDOWS-PACKAGING.md) for code
  signing, the native-module ABI rebuild, and the consolidated go-live decisions
  (sections 5 and 8). This page cross-links there rather than repeating it.
