// migrate.ts: forward-only migration runner.
//
// Uses SQLite's PRAGMA user_version as the version counter. On launch it runs
// every pending migration file in order inside a transaction. No down-migrations
// in v1; a single-user desktop app rolls forward (architecture section 3.3).
//
// Migration files are named NNNN_name.sql. The numeric prefix is the target
// user_version. A file is applied only if its number > the current user_version.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database as DB } from 'better-sqlite3-multiple-ciphers';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Load migrations from a directory, sorted by version. */
export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .map((f) => {
      const version = Number.parseInt(f.slice(0, 4), 10);
      return { version, name: f, sql: readFileSync(join(dir, f), 'utf8') };
    })
    .sort((a, b) => a.version - b.version);
}

/** Apply all pending migrations. Returns the number applied. */
export function runMigrations(db: DB, migrations: Migration[]): number {
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  let applied = 0;
  for (const m of migrations) {
    if (m.version <= current) continue;
    // Each migration runs in its own transaction; user_version is bumped inside
    // the same transaction so a crash mid-migration cannot half-apply.
    const tx = db.transaction(() => {
      db.exec(m.sql);
      // PRAGMA cannot be parameterized; the version is an integer we control.
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
    applied += 1;
  }
  return applied;
}
