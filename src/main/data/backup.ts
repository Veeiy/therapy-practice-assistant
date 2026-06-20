// backup.ts: F6. A REAL passphrase-based encrypted export/backup and a matching
// import/restore. NOT a stub.
//
// Why this exists (audit ruling 5a): the daily DB key is sealed by the OS keystore
// (DPAPI), so it is bound to the therapist's Windows user profile. If that profile
// is lost, reinstalled, or the machine is wiped, the DB key is gone and all PHI is
// permanently unrecoverable. For a clinical record that is a data-loss hazard, not
// a convenience gap. So we provide a portable backup whose key is derived from a
// USER PASSPHRASE (not the OS key), which can be restored on a different machine.
//
// The daily no-passphrase launch UX is unchanged: the passphrase is used ONLY for
// the explicit export/restore, never at every launch.
//
// Format of a .tpabackup file (all lengths are bytes):
//   magic     "TPABK1\n"           (7)            file-type sentinel
//   salt      16                                  scrypt salt
//   iv        12                                  AES-256-GCM iv
//   authTag   16                                  AES-256-GCM tag
//   ciphertext  rest                              GCM-encrypted payload
// The payload plaintext is itself a small JSON envelope:
//   { version, createdAt, db: <base64 of the decrypted .db bytes>,
//     blobs: [{ name, b64 }] }
// We export the DECRYPTED database bytes inside the GCM ciphertext, so the backup
// is protected by the passphrase, not by the machine-bound DB key. Restoring
// re-encrypts into a fresh local DB sealed by the NEW machine's keystore.

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

const MAGIC = Buffer.from('TPABK1\n', 'utf8');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32; // AES-256
// scrypt cost parameters. N must be a power of two; 2^15 is a strong default that
// stays fast enough for an interactive export on a laptop. maxmem raised so Node
// does not reject N=32768.
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface BackupPayload {
  version: 1;
  createdAt: string;
  /** base64 of the decrypted .db file bytes. */
  db: string;
  /** encrypted-at-rest blobs travel as their raw on-disk (already encrypted) bytes;
   * here they are simply carried so a restore reproduces the blob directory. */
  blobs: { name: string; b64: string }[];
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, SCRYPT_PARAMS);
}

/** Encrypt a payload object into a portable backup buffer using the passphrase. */
export function encryptBackup(payload: BackupPayload, passphrase: string): Buffer {
  if (!passphrase || passphrase.length < 8) {
    const err = new Error('Backup passphrase must be at least 8 characters.');
    (err as NodeJS.ErrnoException).code = 'BACKUP_WEAK_PASSPHRASE';
    throw err;
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([MAGIC, salt, iv, authTag, ciphertext]);
}

/** Decrypt a backup buffer with the passphrase. Throws BACKUP_BAD_PASSPHRASE on a
 * wrong passphrase (the GCM auth tag fails) and BACKUP_BAD_FORMAT on a bad file. */
export function decryptBackup(buf: Buffer, passphrase: string): BackupPayload {
  if (buf.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN) {
    throwFormat();
  }
  let off = 0;
  const magic = buf.subarray(off, (off += MAGIC.length));
  if (!magic.equals(MAGIC)) throwFormat();
  const salt = buf.subarray(off, (off += SALT_LEN));
  const iv = buf.subarray(off, (off += IV_LEN));
  const authTag = buf.subarray(off, (off += TAG_LEN));
  const ciphertext = buf.subarray(off);

  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // A wrong passphrase derives a wrong key, so final() throws on the auth tag.
    const err = new Error('The backup passphrase is incorrect, or the file is corrupt.');
    (err as NodeJS.ErrnoException).code = 'BACKUP_BAD_PASSPHRASE';
    throw err;
  }

  try {
    return JSON.parse(plaintext.toString('utf8')) as BackupPayload;
  } catch {
    throwFormat();
  }
}

function throwFormat(): never {
  const err = new Error('This file is not a valid backup.');
  (err as NodeJS.ErrnoException).code = 'BACKUP_BAD_FORMAT';
  throw err;
}
