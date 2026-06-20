// backupService: orchestrates the F6 encrypted export/restore against real files.
//
// EXPORT: open the live encrypted DB with the machine DB key, copy its DECRYPTED
//   contents into a fresh plaintext temp DB (VACUUM INTO), read those bytes, read
//   the blob directory, wrap it all in the passphrase-encrypted backup buffer,
//   write the .tpabackup file. The temp plaintext DB is deleted immediately.
//
// RESTORE: decrypt the backup buffer with the passphrase, write the contained DB
//   bytes to a temp plaintext file, then copy them into a NEW encrypted DB sealed
//   by THIS machine's DB key (so the restored data is encrypted at rest again),
//   and reproduce the blob files. The round-trip is what the unit test proves.
//
// Using VACUUM INTO to materialize decrypted bytes is the clean SQLite-native way
// to snapshot a DB; we then re-key on the way back in.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { openEncryptedDb } from './db.js';
import { encryptBackup, decryptBackup, type BackupPayload } from './backup.js';

export interface BackupServicePaths {
  /** the live encrypted DB file. */
  dbPath: string;
  /** the encrypted blob directory (may not exist if no attachments yet). */
  blobDir?: string;
}

/** Read the live encrypted DB and produce a passphrase-encrypted backup buffer. */
export function exportEncryptedBackup(
  paths: BackupServicePaths,
  key: Buffer,
  passphrase: string
): Buffer {
  const work = mkdtempSync(join(tmpdir(), 'tpa-export-'));
  const plainDbPath = join(work, 'plain.db');
  try {
    // Open the live (encrypted) DB and VACUUM INTO a plaintext copy.
    const live = openEncryptedDb({ dbPath: paths.dbPath, key, readonly: true });
    try {
      // VACUUM INTO writes a brand-new, un-keyed (plaintext) database file.
      live.exec(`VACUUM INTO '${plainDbPath.replace(/'/g, "''")}'`);
    } finally {
      live.close();
    }

    const dbBytes = readFileSync(plainDbPath);
    const blobs = readBlobs(paths.blobDir);

    const payload: BackupPayload = {
      version: 1,
      createdAt: new Date().toISOString(),
      db: dbBytes.toString('base64'),
      blobs,
    };
    return encryptBackup(payload, passphrase);
  } finally {
    // Never leave decrypted bytes on disk.
    rmSync(work, { recursive: true, force: true });
  }
}

/** Restore a backup buffer into a NEW encrypted DB (+blobs) sealed by `key`. */
export function restoreEncryptedBackup(
  buf: Buffer,
  passphrase: string,
  dest: BackupServicePaths,
  key: Buffer
): { tables: number } {
  const payload = decryptBackup(buf, passphrase); // throws on bad passphrase/format
  const work = mkdtempSync(join(tmpdir(), 'tpa-restore-'));
  const plainDbPath = join(work, 'plain.db');
  try {
    writeFileSync(plainDbPath, Buffer.from(payload.db, 'base64'));

    // Open the plaintext snapshot, then VACUUM INTO a freshly-keyed encrypted DB
    // at the destination path.
    const plain = new Database(plainDbPath, { readonly: true });
    try {
      if (existsSync(dest.dbPath)) rmSync(dest.dbPath, { force: true });
      const hex = key.toString('hex');
      // ATTACH an encrypted target and copy via sqlcipher_export-equivalent. The
      // multiple-ciphers build supports keyed ATTACH; we set its key then export.
      plain.exec(`ATTACH DATABASE '${dest.dbPath.replace(/'/g, "''")}' AS enc KEY "x'${hex}'"`);
      // sqlite3_multiple_ciphers exposes sqlcipher_export to copy a whole DB into
      // an attached (encrypted) database.
      plain.exec(`SELECT sqlcipher_export('enc')`);
      plain.exec(`DETACH DATABASE enc`);
    } finally {
      plain.close();
    }

    // Reproduce blob files.
    if (payload.blobs.length > 0 && dest.blobDir) {
      mkdirSync(dest.blobDir, { recursive: true });
      for (const b of payload.blobs) {
        writeFileSync(join(dest.blobDir, b.name), Buffer.from(b.b64, 'base64'));
      }
    }

    // Sanity: open the restored encrypted DB and count tables to confirm it keyed.
    const restored = openEncryptedDb({ dbPath: dest.dbPath, key, readonly: true });
    try {
      const row = restored
        .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table'`)
        .get() as { n: number };
      return { tables: row.n };
    } finally {
      restored.close();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function readBlobs(blobDir?: string): { name: string; b64: string }[] {
  if (!blobDir || !existsSync(blobDir)) return [];
  return readdirSync(blobDir).map((name) => ({
    name,
    b64: readFileSync(join(blobDir, name)).toString('base64'),
  }));
}
