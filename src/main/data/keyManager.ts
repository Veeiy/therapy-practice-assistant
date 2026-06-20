// keyManager: the DB key lifecycle. No passphrase the therapist must remember.
//
//  First run:  generate a random 256-bit key, seal it with the OS keystore
//              (DPAPI via SecretSealer), persist the sealed blob next to the DB.
//  Every launch: read the sealed blob, unseal it, hand the raw key to db.ts which
//              issues PRAGMA key. The therapist never sees a passphrase; the key
//              is bound to her Windows login.
//
// Trade-off (documented for the operator, addressed by the F6 passphrase export):
// a DPAPI-sealed key does not survive a move to a different Windows user or a
// wiped machine. The passphrase-based encrypted export is the recovery path.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { SecretSealer } from '../secure/secretSealer.js';

export const DB_KEY_BYTES = 32; // 256-bit AES key

/**
 * Returns the raw 32-byte DB key, creating+sealing it on first run.
 * @param sealedKeyPath absolute path to the sealed-key file (userData/db.key.sealed)
 * @param sealer the OS keystore wrapper
 */
export function loadOrCreateDbKey(sealedKeyPath: string, sealer: SecretSealer): Buffer {
  if (!sealer.isAvailable()) {
    // Fail closed: never write an unsealed key. researcher.2 finding 9 guard.
    const err = new Error(
      'OS encryption is not available, so the database key cannot be sealed safely.'
    );
    (err as NodeJS.ErrnoException).code = 'ENCRYPTION_UNAVAILABLE';
    throw err;
  }

  if (existsSync(sealedKeyPath)) {
    const sealed = readFileSync(sealedKeyPath);
    const key = sealer.unseal(sealed);
    if (key.length !== DB_KEY_BYTES) {
      throw new Error('Sealed database key is the wrong length; the key file may be corrupt.');
    }
    return key;
  }

  // First run: mint a fresh key and seal it.
  const key = randomBytes(DB_KEY_BYTES);
  const sealed = sealer.seal(key);
  // 0o600: owner read/write only.
  writeFileSync(sealedKeyPath, sealed, { mode: 0o600 });
  return key;
}
