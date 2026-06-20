// firstRun: tracks whether the user has acknowledged the first-run disclaimers
// (hard rule 3: plain-language disclaimers, BAA gate language, "not a medical
// device / not legal advice"). It is a single non-PHI flag file in userData.
//
// The shell shows the disclaimer screen until firstRunAcknowledge() is called.
// Keeping this server-side (main process) means the renderer cannot skip it by
// clearing its own storage; the flag lives with the app data.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface FirstRunState {
  acknowledged: boolean;
  acknowledgedAt?: string;
  /** which disclaimer version was acknowledged, so a future revision can re-prompt. */
  version?: number;
}

export const DISCLAIMER_VERSION = 1;

export class FirstRunStore {
  constructor(private readonly path: string) {}

  status(): { acknowledged: boolean } {
    try {
      if (existsSync(this.path)) {
        const s = JSON.parse(readFileSync(this.path, 'utf8')) as FirstRunState;
        return { acknowledged: s.acknowledged === true && s.version === DISCLAIMER_VERSION };
      }
    } catch {
      /* treat a corrupt flag as not-acknowledged so the disclaimer shows again */
    }
    return { acknowledged: false };
  }

  acknowledge(): void {
    const state: FirstRunState = {
      acknowledged: true,
      acknowledgedAt: new Date().toISOString(),
      version: DISCLAIMER_VERSION,
    };
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
}
