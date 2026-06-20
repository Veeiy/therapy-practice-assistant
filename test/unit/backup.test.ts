// TEST: the REAL passphrase-based encrypted backup (F6), round-trip + failure modes.
//
// F6 demands a REAL encrypted export/restore, not a stub. The portable backup is
// protected by a USER PASSPHRASE (scrypt-derived key + AES-256-GCM), so it can be
// restored on a different machine even though the daily DB key is bound to the OS
// keystore. We prove:
//  (a) encrypt -> decrypt with the SAME passphrase restores the exact payload,
//  (b) the on-disk backup bytes are ciphertext: they do NOT contain the plaintext
//      payload marker, and they DO start with the file-type magic,
//  (c) a WRONG passphrase fails closed with code BACKUP_BAD_PASSPHRASE (the GCM
//      auth tag rejects it; it does not silently return garbage),
//  (d) a corrupt / non-backup file fails closed with BACKUP_BAD_FORMAT,
//  (e) a too-weak passphrase is refused up front with BACKUP_WEAK_PASSPHRASE,
//  (f) a single flipped ciphertext byte is detected (tamper-evident).

import { describe, it, expect } from 'vitest';
import { encryptBackup, decryptBackup, type BackupPayload } from '../../src/main/data/backup.js';

const MARKER = 'PLAINTEXT_DB_MARKER_98765';

function samplePayload(): BackupPayload {
  return {
    version: 1,
    createdAt: '2026-06-17T12:00:00.000Z',
    // base64 of some bytes that contain a distinctive marker, standing in for the
    // decrypted .db file bytes.
    db: Buffer.from(`sqlite-bytes ${MARKER} more-bytes`).toString('base64'),
    blobs: [{ name: 'attachment-1.bin', b64: Buffer.from('blobdata').toString('base64') }],
  };
}

describe('encrypted backup (F6)', () => {
  const passphrase = 'correct horse battery staple';

  it('(a) round-trips the exact payload with the right passphrase', () => {
    const payload = samplePayload();
    const buf = encryptBackup(payload, passphrase);
    const restored = decryptBackup(buf, passphrase);
    expect(restored).toEqual(payload);
    // and the embedded db bytes decode back to the original
    expect(Buffer.from(restored.db, 'base64').toString('utf8')).toContain(MARKER);
  });

  it('(b) writes ciphertext: no plaintext marker on disk, but the magic is present', () => {
    const buf = encryptBackup(samplePayload(), passphrase);
    // the decrypted-db marker must NOT appear in the encrypted backup bytes
    expect(buf.includes(Buffer.from(MARKER))).toBe(false);
    // nor should the literal base64 of the payload leak
    expect(buf.includes(Buffer.from('"version":1'))).toBe(false);
    // the file-type magic IS at the front
    expect(buf.subarray(0, 7).toString('utf8')).toBe('TPABK1\n');
  });

  it('(c) fails closed on a wrong passphrase', () => {
    const buf = encryptBackup(samplePayload(), passphrase);
    expect(() => decryptBackup(buf, 'the wrong passphrase entirely')).toThrowError(
      expect.objectContaining({ code: 'BACKUP_BAD_PASSPHRASE' })
    );
  });

  it('(d) fails closed on a non-backup / corrupt file', () => {
    const notABackup = Buffer.from('this is just a random text file, not a backup at all');
    expect(() => decryptBackup(notABackup, passphrase)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_BAD_FORMAT' })
    );
  });

  it('(e) refuses a too-weak passphrase up front', () => {
    expect(() => encryptBackup(samplePayload(), 'short')).toThrowError(
      expect.objectContaining({ code: 'BACKUP_WEAK_PASSPHRASE' })
    );
  });

  it('(f) is tamper-evident: a single flipped ciphertext byte is rejected', () => {
    const buf = encryptBackup(samplePayload(), passphrase);
    const tampered = Buffer.from(buf);
    // flip a byte well past the header, inside the ciphertext region
    const idx = tampered.length - 1;
    tampered[idx] = tampered[idx] ^ 0xff;
    expect(() => decryptBackup(tampered, passphrase)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_BAD_PASSPHRASE' })
    );
  });
});
