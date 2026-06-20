// force-win32-sdk.cjs
//
// THE cross-platform optional-dependency fix (researcher.2 finding 5).
// npm installs only the optional dependency that matches the CURRENT machine's
// OS/arch. Building on macOS installs the darwin binary and SILENTLY skips the
// win32-x64 one, so a naively packaged Windows build ships WITHOUT the claude.exe
// it needs and throws "Native CLI binary for win32 not found" at first use.
//
// electron-builder runs this in `beforeBuild` (see electron-builder.yml). It force-
// installs the win32 optional dependency so the binary is present in the package.
//
// PREFERRED alternative: build on a real Windows host / CI, where npm resolves the
// win32 binary naturally. This script is the macOS-host bridge.
//
// It is a no-op (and prints why) when already on win32, or when the dep is present.

const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const PKG = '@anthropic-ai/claude-agent-sdk-win32-x64';

function log(msg) {
  process.stdout.write(`[force-win32-sdk] ${msg}\n`);
}

try {
  const target = join(process.cwd(), 'node_modules', PKG);
  if (existsSync(target)) {
    log(`${PKG} already present. Nothing to do.`);
    process.exit(0);
  }
  if (process.platform === 'win32') {
    log('Running on win32; npm resolves the native binary naturally. Nothing to do.');
    process.exit(0);
  }
  log(`Forcing install of ${PKG} so the Windows build includes claude.exe...`);
  // --force and --no-save: we only need the files present at package time; we do
  // not want to mutate package.json's dependency tree.
  execSync(`npm install ${PKG} --no-save --force`, { stdio: 'inherit' });
  log('Done. Verify the binary exists before packaging:');
  log(`  node_modules/${PKG}/claude.exe`);
} catch (e) {
  log('FAILED to force-install the win32 SDK binary.');
  log('The Windows build will ship without an engine. Build on a Windows host instead.');
  log(String(e && e.message ? e.message : e));
  process.exit(1);
}
