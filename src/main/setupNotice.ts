// setupNotice: tracks whether the user dismissed the first-run SETUP notice
// (the small banner that points at the companion setup plugin while no Practice
// Profile exists yet). Same shape and philosophy as FirstRunStore: a single
// non-PHI flag file in userData, kept main-process side so the renderer cannot
// lose it by clearing its own storage, and a corrupt file is treated as
// not-dismissed so the notice simply shows again.
//
// The notice itself never blocks the app; it is informational only. Once a
// Practice Profile exists the shell stops showing it regardless of this flag.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface SetupNoticeState {
  dismissed: boolean;
  dismissedAt?: string;
}

export class SetupNoticeStore {
  constructor(private readonly path: string) {}

  status(): { dismissed: boolean } {
    try {
      if (existsSync(this.path)) {
        const s = JSON.parse(readFileSync(this.path, 'utf8')) as SetupNoticeState;
        return { dismissed: s.dismissed === true };
      }
    } catch {
      /* treat a corrupt flag as not-dismissed so the notice shows again */
    }
    return { dismissed: false };
  }

  dismiss(): void {
    const state: SetupNoticeState = {
      dismissed: true,
      dismissedAt: new Date().toISOString(),
    };
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
}
