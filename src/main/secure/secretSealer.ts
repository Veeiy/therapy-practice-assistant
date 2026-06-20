// SecretSealer abstracts the OS keystore (Electron safeStorage / Windows DPAPI)
// behind a tiny interface.
//
// Why an interface and not safeStorage directly:
//  - In PRODUCTION the ElectronSafeStorageSealer wraps safeStorage, which seals a
//    secret with DPAPI bound to the therapist's Windows login (researcher.2). The
//    DB key and the API key are both sealed this way.
//  - In TESTS we inject a deterministic in-memory sealer so the data layer is
//    fully testable under plain Node without launching Electron. The tests still
//    prove the REAL behaviour that matters: the DB on disk is ciphertext, the key
//    round-trips, signed notes are immutable. None of that depends on DPAPI.
//
// This is also the cleaner architecture: the spine depends on a capability
// ("seal/unseal bytes"), not on a specific Electron API.

export interface SecretSealer {
  /** true if sealing is available. safeStorage.isEncryptionAvailable() in prod. */
  isAvailable(): boolean;
  /** seal plaintext -> opaque ciphertext bytes (DPAPI in prod). */
  seal(plain: Buffer): Buffer;
  /** unseal ciphertext bytes -> plaintext (DPAPI in prod). */
  unseal(sealed: Buffer): Buffer;
}

/**
 * Production sealer. Lazily requires electron so this module can be imported by
 * code paths (and tests) that never call into it. The real binding is created in
 * the main process where `electron` is available.
 */
export function createElectronSealer(): SecretSealer {
  // Imported lazily; only valid inside the Electron main process.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { safeStorage } = require('electron') as typeof import('electron');
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    seal: (plain) => safeStorage.encryptString(plain.toString('utf8')),
    unseal: (sealed) => Buffer.from(safeStorage.decryptString(sealed), 'utf8'),
  };
}
