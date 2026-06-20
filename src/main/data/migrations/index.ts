// Migration registry.
//
// We embed each migration's SQL as a string via Vite's ?raw import so the SQL
// travels inside the JS bundle and is available identically in dev, in the
// packaged asar, and under vitest. This avoids the classic "the .sql file is not
// where I expected after packaging" problem (the same class of bug the SDK's
// asar-unpack rule fixes for the native binary).
//
// To add a migration: drop NNNN_name.sql in this folder, import it ?raw, and add
// it to the array. The runner applies any whose version > PRAGMA user_version.

import init0001 from './0001_init.sql?raw';
import type { Migration } from '../migrate.js';

export const MIGRATIONS: Migration[] = [
  { version: 1, name: '0001_init.sql', sql: init0001 },
];
