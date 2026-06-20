// TEST: encrypted DB round-trip.
// Proves:
//  (a) data written through the cipher CANNOT be read as plaintext from the .db
//      file on disk (the ciphertext does not contain our marker string),
//  (b) it reads back correctly when reopened with the SAME key,
//  (c) opening with a WRONG key fails closed (throws), it does not silently open
//      an empty database,
//  (d) the keyManager seals/round-trips a generated key via the (fake) sealer.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openEncryptedDb } from '../../src/main/data/db.js';
import { loadOrCreateDbKey } from '../../src/main/data/keyManager.js';
import { fakeSealer, tempDir } from '../helpers.js';

describe('encrypted database', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it('writes ciphertext to disk and reads back only with the right key', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const dbPath = join(dir, 'practice.db');
    const key = randomBytes(32);
    const MARKER = 'PLAINTEXT_SECRET_MARKER_12345';

    // Write a row containing a distinctive marker, then close (flush).
    {
      const db = openEncryptedDb({ dbPath, key });
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
      db.prepare('INSERT INTO t (v) VALUES (?)').run(MARKER);
      db.close();
    }

    // (a) The raw file bytes must NOT contain the marker (whole-DB encryption).
    const raw = readFileSync(dbPath);
    expect(raw.includes(Buffer.from(MARKER))).toBe(false);
    // It also must not start with the standard "SQLite format 3" plaintext header.
    expect(raw.subarray(0, 16).toString('utf8')).not.toContain('SQLite format 3');

    // (b) Reopen with the same key and read the marker back.
    {
      const db = openEncryptedDb({ dbPath, key });
      const row = db.prepare('SELECT v FROM t WHERE id = 1').get() as { v: string };
      expect(row.v).toBe(MARKER);
      db.close();
    }

    // (c) A wrong key must fail closed.
    const wrongKey = randomBytes(32);
    expect(() => openEncryptedDb({ dbPath, key: wrongKey })).toThrow();
  });

  it('keyManager generates, seals, and round-trips the DB key', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const sealedPath = join(dir, 'db.key.sealed');
    const sealer = fakeSealer(true);

    // First run: creates and seals a 32-byte key.
    const k1 = loadOrCreateDbKey(sealedPath, sealer);
    expect(k1).toHaveLength(32);
    expect(existsSync(sealedPath)).toBe(true);

    // Second run: unseals the SAME key.
    const k2 = loadOrCreateDbKey(sealedPath, sealer);
    expect(k2.equals(k1)).toBe(true);
  });

  it('keyManager fails closed if OS encryption is unavailable', () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const sealedPath = join(dir, 'db.key.sealed');
    const sealer = fakeSealer(false); // isAvailable() -> false
    expect(() => loadOrCreateDbKey(sealedPath, sealer)).toThrowError(/encryption is not available/i);
    // and it must NOT have written an unsealed key
    expect(existsSync(sealedPath)).toBe(false);
  });
});
