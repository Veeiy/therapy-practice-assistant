// rebuild-native.mjs
//
// better-sqlite3-multiple-ciphers is a native module. In the FINAL Electron build
// it must be compiled against Electron's ABI (electron-rebuild does this). During
// plain Node development and testing it is compiled against the host Node ABI,
// which is what `npm install` already does.
//
// This postinstall hook is intentionally lenient (the package.json calls it with
// `|| true`): it tries an electron-rebuild only if electron is installed AND we
// are not in a CI/test-only context. If electron-rebuild is unavailable, it does
// nothing, leaving the Node-ABI build that the test suite uses. The operator runs
// a real electron-rebuild on the Windows packaging host (see the packaging doc).

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const log = (m) => process.stdout.write(`[rebuild-native] ${m}\n`);

const electronPkg = join(process.cwd(), 'node_modules', 'electron', 'package.json');
if (!existsSync(electronPkg)) {
  log('electron not installed; leaving the Node-ABI native build in place (fine for tests).');
  process.exit(0);
}

// We do NOT auto-run electron-rebuild here to keep `npm install` fast and to avoid
// breaking the Node-ABI build the vitest suite depends on. The Windows packaging
// step runs electron-rebuild explicitly. This hook exists as the documented place
// to wire that if the operator wants it automatic.
log('electron present. Skipping auto electron-rebuild (run it on the packaging host).');
process.exit(0);
