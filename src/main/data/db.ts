// db.ts: open the encrypted SQLite database.
//
// We use better-sqlite3-multiple-ciphers in SQLCipher-compatible AES-256 mode.
// Whole-DB page encryption means indexes and pages are encrypted on disk; queries
// stay ordinary SQL with no per-record crypto plumbing (researcher.2 finding 10).
//
// The raw 32-byte key from keyManager is applied as a raw hex key:
//   PRAGMA key = "x'<64 hex chars>'";
// The leading x'...' form tells SQLite3MultipleCiphers to use the bytes verbatim
// as the key (no KDF over a passphrase), which is what we want for a CSPRNG key.

import Database from 'better-sqlite3-multiple-ciphers';
import type { Database as DB } from 'better-sqlite3-multiple-ciphers';

export interface OpenDbOptions {
  /** absolute path to the .db file. ':memory:' is NOT supported for the encrypted
   * round-trip test (we need a real file to prove ciphertext on disk), so callers
   * pass a temp file path. */
  dbPath: string;
  /** the raw 32-byte key from keyManager. */
  key: Buffer;
  /** optional: open read-only (used by the backup exporter). */
  readonly?: boolean;
}

/**
 * Open (and key) the encrypted database. Throws if the key is wrong (the verify
 * SELECT will fail to read the schema), which is the fail-closed behaviour we
 * want: a wrong/lost key must not silently open an empty DB.
 */
export function openEncryptedDb(opts: OpenDbOptions): DB {
  const db: DB = new Database(opts.dbPath, { readonly: opts.readonly ?? false });

  // Select the SQLCipher cipher scheme, then apply the raw key.
  db.pragma(`cipher='sqlcipher'`);
  const hex = opts.key.toString('hex');
  db.pragma(`key="x'${hex}'"`);

  // Verify the key actually decrypts the database. On a wrong key this throws
  // 'file is not a database', which we surface rather than swallow.
  try {
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
  } catch (e) {
    db.close();
    const err = new Error('The database key did not unlock the database.');
    (err as NodeJS.ErrnoException).code = 'BAD_DB_KEY';
    (err as Error).cause = e;
    throw err;
  }

  // Sensible pragmas for a single-user desktop app.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
