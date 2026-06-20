// seed-synthetic.mjs: a DEVELOPER convenience to materialize the synthetic demo
// data into a local encrypted DB WITHOUT launching the Electron GUI.
//
// IMPORTANT: this is NOT the production path. In production the DB key is sealed by
// the OS keystore (DPAPI) and lives in the per-user app-data directory. Here, so the
// operator can inspect the seeded data on a dev machine, we generate a random key
// and write it UNSEALED next to the dev DB, clearly named .dev-insecure. Never use
// this on real client data. It exists only to demonstrate the seed + schema.
//
// Usage:  node scripts/seed-synthetic.mjs [outDir]
// Default outDir: ./.devdata
//
// Because the app's TS is ESM compiled by electron-vite, this script imports the
// already-built JS from dist/. Run `npm run build` first, or point it at source via
// a loader. To keep it dependency-free we require the built output.

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const outDir = resolve(process.argv[2] ?? '.devdata');
const dbPath = join(outDir, 'practice.dev.db');
const keyPath = join(outDir, 'db.key.dev-insecure');

async function loadBuilt() {
  const base = resolve('dist/main');
  const dataStoreUrl = pathToFileURL(join(base, 'dataStore.js')).href;
  const seedUrl = pathToFileURL(join(base, 'seedSynthetic.js')).href;
  try {
    const { openDataStore } = await import(dataStoreUrl);
    const { seedSynthetic } = await import(seedUrl);
    return { openDataStore, seedSynthetic };
  } catch (e) {
    console.error(
      '[seed] Could not import the built app. Run `npm run build` first so dist/main exists.'
    );
    console.error('[seed] underlying error:', e?.message ?? e);
    process.exit(1);
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  // fresh dev DB each run so the seed is deterministic and obvious
  if (existsSync(dbPath)) rmSync(dbPath, { force: true });

  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  console.log(`[seed] dev key (INSECURE, dev only) written to ${keyPath}`);

  const { openDataStore, seedSynthetic } = await loadBuilt();
  const store = openDataStore({ dbPath, key });
  const result = seedSynthetic(store);
  store.close();

  console.log('[seed] seeded synthetic demo data into', dbPath);
  console.log('[seed] clients:', result.clientIds.length);
  console.log('[seed] appointments:', result.appointmentIds.length);
  console.log('[seed] code picklist items:', result.codeItemCount);
  console.log('[seed] All records are obviously fictional and marked demo=1.');
}

main().catch((e) => {
  console.error('[seed] failed:', e?.message ?? e);
  process.exit(1);
});
