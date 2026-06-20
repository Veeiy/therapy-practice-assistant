// paths: the single place that decides WHERE the app keeps its data on disk.
//
// Everything PHI-bearing lives under the OS per-user app-data directory
// (app.getPath('userData')), which on Windows is %APPDATA%/<appId>. Nothing is
// written next to the .exe (that would be machine-wide and not per-user).
//
// Layout under userData/:
//   practice.db            the encrypted SQLite database (whole-DB AES-256)
//   db.key.sealed          the DB key, sealed by the OS keystore (DPAPI)
//   anthropic.key.sealed   the Anthropic API key, sealed by the OS keystore
//   config.json            layered config overrides (non-PHI)
//   firstrun.json          first-run acknowledgement flag (non-PHI)
//   blobs/                 encrypted attachment blobs
//
// This module is tiny and dependency-light so tests can call buildPaths() with a
// fake base dir instead of a real Electron app.

import { join } from 'node:path';

export interface AppPaths {
  userData: string;
  dbPath: string;
  sealedDbKeyPath: string;
  sealedApiKeyPath: string;
  configPath: string;
  firstRunPath: string;
  blobDir: string;
}

/** Build the concrete file paths from a base user-data directory. */
export function buildPaths(userData: string): AppPaths {
  return {
    userData,
    dbPath: join(userData, 'practice.db'),
    sealedDbKeyPath: join(userData, 'db.key.sealed'),
    sealedApiKeyPath: join(userData, 'anthropic.key.sealed'),
    configPath: join(userData, 'config.json'),
    firstRunPath: join(userData, 'firstrun.json'),
    blobDir: join(userData, 'blobs'),
  };
}
