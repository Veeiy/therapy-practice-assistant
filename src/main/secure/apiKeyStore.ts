// apiKeyStore: stores the Anthropic API key SEALED by the OS keystore (DPAPI),
// exactly like the DB key. The plaintext key is only ever materialized in memory
// for the moment a real model call is made, and is NEVER logged or written
// unsealed to disk.
//
// In THIS build no real call is made (synthetic-only, real egress gated off), but
// the store exists so the operator can paste a key at go-live and the SDK provider
// can read it. The key is sealed the same way as the DB key, so it inherits the
// same machine-bound protection.
//
// Safety floor: the app itself never ENTERS a key into any external field. It only
// stores what the operator types into the local Settings screen, sealed at rest.

import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SecretSealer } from './secretSealer.js';

export class ApiKeyStore {
  constructor(
    private readonly sealedPath: string,
    private readonly sealer: SecretSealer
  ) {}

  /** Is a key currently stored? (presence check only; never returns the key). */
  has(): boolean {
    return existsSync(this.sealedPath);
  }

  /** Is OS sealing available? The renderer shows a clear message if not. */
  encryptionAvailable(): boolean {
    return this.sealer.isAvailable();
  }

  /**
   * Seal and store a key the operator typed locally. Fails closed if OS encryption
   * is unavailable rather than writing the key in the clear.
   */
  set(plaintextKey: string): void {
    if (!this.sealer.isAvailable()) {
      const err = new Error(
        'OS encryption is not available, so the API key cannot be stored securely.'
      );
      (err as NodeJS.ErrnoException).code = 'ENCRYPTION_UNAVAILABLE';
      throw err;
    }
    const trimmed = plaintextKey.trim();
    if (!trimmed) throw new Error('The API key is empty.');
    const sealed = this.sealer.seal(Buffer.from(trimmed, 'utf8'));
    mkdirSync(dirname(this.sealedPath), { recursive: true });
    writeFileSync(this.sealedPath, sealed, { mode: 0o600 });
  }

  /**
   * Unseal and return the key, or null if none is stored. Caller uses it only for
   * the duration of a single model call and never logs it.
   */
  get(): string | null {
    if (!existsSync(this.sealedPath)) return null;
    if (!this.sealer.isAvailable()) return null;
    const sealed = readFileSync(this.sealedPath);
    return this.sealer.unseal(sealed).toString('utf8');
  }

  /** Remove the stored key (operator action; e.g. before handing off a machine). */
  clear(): void {
    if (existsSync(this.sealedPath)) rmSync(this.sealedPath, { force: true });
  }
}
