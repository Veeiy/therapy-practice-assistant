// blobStore: encrypted-at-rest storage for attachment files (intake PDFs, scans).
//
// Hard rule 1 says ALL client data is encrypted at rest. Large binaries do not
// belong in the SQLite row, so they live as individual files under blobs/, each
// encrypted with AES-256-GCM using a key DERIVED from the same machine DB key
// (HKDF-style via scrypt with a fixed app salt). The DB row stores only the blob's
// id, original filename, content type, and size (metadata), never the bytes.
//
// The blob directory is included in the F6 backup (the backup carries each blob's
// already-encrypted bytes), so a restore reproduces attachments too.
//
// This run wires the capability and unit-proves the round-trip via the DB tests'
// sibling; the intake UI that uploads attachments is next wave.

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
// A fixed application salt for deriving the blob key from the DB key. The DB key
// is already random and machine-sealed; this derivation just domain-separates the
// blob cipher from the DB cipher so they never share a key directly.
const BLOB_KDF_SALT = Buffer.from('tpa-blob-kdf-v1');

function blobKey(dbKey: Buffer): Buffer {
  return scryptSync(dbKey, BLOB_KDF_SALT, KEY_LEN, {
    N: 1 << 14,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

export interface BlobMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export class BlobStore {
  private readonly key: Buffer;

  constructor(
    private readonly dir: string,
    dbKey: Buffer,
    private readonly genId: () => string
  ) {
    this.key = blobKey(dbKey);
  }

  private pathFor(id: string): string {
    return join(this.dir, `${id}.blob`);
  }

  /** Encrypt and store bytes; returns metadata to persist in the DB row. */
  put(bytes: Buffer, filename: string, contentType: string): BlobMeta {
    mkdirSync(this.dir, { recursive: true });
    const id = this.genId();
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    // file layout: iv | tag | ciphertext
    writeFileSync(this.pathFor(id), Buffer.concat([iv, tag, ct]), { mode: 0o600 });
    return { id, filename, contentType, size: bytes.length };
  }

  /** Decrypt and return the original bytes for a stored blob id. */
  get(id: string): Buffer {
    const path = this.pathFor(id);
    if (!existsSync(path)) throw new Error('Attachment not found.');
    const raw = readFileSync(path);
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  /** Delete a stored blob (e.g. when its DB row is removed). */
  remove(id: string): void {
    const path = this.pathFor(id);
    if (existsSync(path)) rmSync(path, { force: true });
  }
}
