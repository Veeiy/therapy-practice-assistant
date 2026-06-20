// Test helpers: a deterministic in-memory sealer and a temp-file data store.
//
// We do NOT launch Electron in tests (the brief says the GUI cannot be run
// headless here, and that is fine). Instead we inject a fake SecretSealer that
// stands in for DPAPI. The tests still prove the behaviour that matters: the DB on
// disk is ciphertext, the key round-trips, signed notes are immutable, etc. None
// of that depends on the real OS keystore.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SecretSealer } from '../src/main/secure/secretSealer.js';
import type { Clock, IdGen } from '../src/main/data/repositories/support.js';
import { openDataStore, type DataStore } from '../src/main/data/dataStore.js';

/**
 * A fake sealer that "seals" by prefixing a tag and base64-ing. It is reversible
 * and deterministic, which is all the keyManager contract needs. It is NOT secure
 * and is only used in tests; production uses the real DPAPI-backed sealer.
 */
export function fakeSealer(available = true): SecretSealer {
  const TAG = Buffer.from('FAKESEAL:');
  return {
    isAvailable: () => available,
    seal: (plain) => Buffer.concat([TAG, Buffer.from(plain.toString('base64'))]),
    unseal: (sealed) => {
      const body = sealed.subarray(TAG.length).toString('utf8');
      return Buffer.from(body, 'base64');
    },
  };
}

/** A deterministic clock that advances by 1 second on every read. */
export function fakeClock(startMs = Date.UTC(2026, 5, 17, 12, 0, 0)): Clock {
  let t = startMs;
  return {
    nowIso: () => {
      const iso = new Date(t).toISOString();
      t += 1000;
      return iso;
    },
  };
}

/** A deterministic id generator: id-1, id-2, ... so tests can assert exact ids. */
export function fakeIds(prefix = 'id'): IdGen {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

/** Make a fresh temp directory the caller is responsible for cleaning. */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tpa-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Open a FRESH encrypted DataStore on a temp file with a deterministic clock + id
 * generator, plus the cleanup that closes it and removes the temp dir. This is the
 * one-call fixture the Wave 3 module tests build their services on: every test gets
 * an isolated, migrated, ciphertext-on-disk store with no shared state.
 *
 * A random 32-byte key is fine here: the tests do not need a stable key across runs,
 * only that the file is genuinely encrypted. Pass a fixed `key` if a test wants to
 * reopen the same file across two stores.
 */
export function freshStore(opts?: {
  clock?: Clock;
  ids?: IdGen;
  key?: Buffer;
}): { store: DataStore; dbPath: string; dir: string; cleanup: () => void } {
  const { dir, cleanup: rmDir } = tempDir();
  const dbPath = join(dir, 'practice.db');
  const store = openDataStore({
    dbPath,
    key: opts?.key ?? randomBytes(32),
    clock: opts?.clock ?? fakeClock(),
    ids: opts?.ids ?? fakeIds(),
  });
  const cleanup = () => {
    try {
      store.close();
    } finally {
      rmDir();
    }
  };
  return { store, dbPath, dir, cleanup };
}
