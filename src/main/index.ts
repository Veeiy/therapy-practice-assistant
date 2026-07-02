// main/index.ts: the Electron MAIN PROCESS entry point. This is the spine's
// composition root. It runs, in order:
//
//   1. resolve per-user paths (userData), and the data mode (synthetic this build),
//   2. open the OS keystore sealer (DPAPI) and load-or-create the sealed DB key,
//      failing closed if OS encryption is unavailable (hard rule 1),
//   3. open the ENCRYPTED data store and run migrations,
//   4. seed obviously-fictional synthetic data on first run (hard rule 4),
//   5. build the config store (defaults + module defaults + user overrides),
//   6. build the agent runtime (Mock provider in this build) + API key store,
//   7. build the modules and host them (config merge + IPC registration),
//   8. register the shell handlers,
//   9. create the BrowserWindow with a locked-down webPreferences
//      (contextIsolation on, nodeIntegration off, sandbox on) and load the renderer.
//
// Security posture set here:
//   * the renderer gets NO Node, NO remote module, NO direct DB/SDK access; it
//     talks only to the whitelisted preload bridge,
//   * a strict Content-Security-Policy is applied to renderer responses,
//   * external navigation and new-window opening are denied (no surprise web load).
//
// NOTE: this file imports `electron`, so it only runs inside Electron, never under
// vitest. The data/agent layers it composes are the same ones the tests cover.

import { app, BrowserWindow, ipcMain, shell, session } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { buildPaths } from './paths.js';
import { createElectronSealer } from './secure/secretSealer.js';
import { loadOrCreateDbKey } from './data/keyManager.js';
import { openDataStore } from './data/dataStore.js';
import { seedSynthetic } from './data/seedSynthetic.js';
import { ConfigStore } from './config/configStore.js';
import { APP_DEFAULT_CONFIG, resolveProductName } from './config/defaults.js';
import { ApiKeyStore } from './secure/apiKeyStore.js';
import { AgentRuntime } from './agent/runtime.js';
import { consoleLogger } from './agent/logger.js';
import { ModuleHost, resolveEnabledModules } from './moduleHost.js';
import { MainIpcRouter } from './ipc/router.js';
import { registerShellHandlers } from './ipc/shellHandlers.js';
import { FirstRunStore } from './firstRun.js';
import { SetupNoticeStore } from './setupNotice.js';
import { PracticeProfileStore } from './practiceProfileStore.js';
import { buildModules } from '../modules/index.js';
import type { DataMode } from '../shared/constants.js';

const log = consoleLogger;

/** Build the entire main-process object graph. Returns the live DB key + paths the
 * backup handlers need. Throws (fail closed) if encryption is unavailable. */
function bootSpine() {
  const paths = buildPaths(app.getPath('userData'));

  // (2) seal + DB key. loadOrCreateDbKey throws ENCRYPTION_UNAVAILABLE if the OS
  // keystore is not usable, which we surface rather than running unencrypted.
  const sealer = createElectronSealer();
  const dbKey = loadOrCreateDbKey(paths.sealedDbKeyPath, sealer);

  // (3) encrypted store + migrations.
  const firstBoot = !existsSync(paths.dbPath);
  const store = openDataStore({ dbPath: paths.dbPath, key: dbKey });

  // (4) seed obviously-fictional data the first time only.
  if (firstBoot) {
    seedSynthetic(store);
    log.event('seeded_synthetic_data', { firstBoot: true });
  }

  // data mode: synthetic-only this build. It reads from the config store, but the
  // config store is built AFTER the modules (we need each module's defaultConfig to
  // build it). To avoid an initialization-order trap, dataMode() closes over a
  // late-bound `config` holder that is assigned below before anything calls it.
  let config: ConfigStore | null = null;
  const dataMode: () => DataMode = () => {
    const mode = config?.get<DataMode>('app.dataMode') ?? 'synthetic';
    return mode === 'real' ? 'real' : 'synthetic';
  };

  // (6) API key store (sealed) + agent runtime (Mock provider this build).
  const apiKey = new ApiKeyStore(paths.sealedApiKeyPath, sealer);
  const runtime = new AgentRuntime({
    log,
    getApiKey: () => apiKey.get(),
    hasApiKey: () => apiKey.has(),
    dataMode,
  });

  // (7) modules + host. Building modules merely constructs them; dataMode() and the
  // config getters are only invoked by handlers at call time, by which point `config`
  // is set. We hand the same late-bound `config` holder in via getConfig so the
  // scheduling reminder template / lead time / practice name and the intake field
  // list resolve against real config once boot completes. The provider selection
  // here is Mock regardless (real egress is gated off), so the synthetic default is
  // correct even if config were not yet loaded.
  const modules = buildModules({ store, runtime, dataMode, getConfig: () => config });
  const host = new ModuleHost(modules);

  // (5) config store: app defaults + module defaults, then user overrides. Assign
  // the late-bound holder so dataMode() now resolves against real config.
  const mergedDefaults = host.mergedDefaultConfig(APP_DEFAULT_CONFIG);
  config = new ConfigStore({ defaults: mergedDefaults, configPath: paths.configPath });

  // first-run disclaimer store (hard rule 3).
  const firstRun = new FirstRunStore(paths.firstRunPath);

  // Custom buildout: the Practice Profile READER (the companion setup plugin is
  // the writer; it provisions config.json, including the practiceProfile
  // namespace) plus the dismissal flag for the first-run setup notice.
  const practiceProfile = new PracticeProfileStore(config);
  const setupNotice = new SetupNoticeStore(paths.setupNoticePath);

  // Custom buildout: the config-driven enablement allowlist. All modules are
  // still BUILT above (construction + config-defaults merge unchanged); only
  // hosting (IPC) and advertising (descriptors) are gated by this set. A missing
  // or malformed value falls back to all modules, so an un-provisioned install
  // behaves exactly as before. Notes is always kept on by the host itself.
  const enabledModules = resolveEnabledModules(config.get('app.enabledModules'));

  // (8) IPC: one router; ENABLED modules + shell register onto it.
  const router = new MainIpcRouter(ipcMain, log);
  host.registerEnabled(router, enabledModules);
  registerShellHandlers(router, {
    store,
    config,
    apiKey,
    firstRun,
    practiceProfile,
    setupNotice,
    host,
    enabledModules,
    dataMode,
    dbKey,
    dbPath: paths.dbPath,
    blobDir: paths.blobDir,
  });

  log.event('spine_ready', {
    modules: modules.length,
    functionalModules: modules.filter((m) => m.functional).length,
    enabledModules: enabledModules.join(','), // module ids only; non-PHI
    dataMode: dataMode(),
  });

  // Custom buildout: the window title honors the provisioned `app.productName`
  // (the setup plugin writes the practice's own display name there; non-PHI, a
  // business name). Sanitized; falls back to the neutral product name.
  const productName = resolveProductName(config.get('app.productName'));

  return { store, dbKey, paths, productName };
}

function createWindow(title: string): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // ── renderer lockdown ──
      contextIsolation: true, // renderer + preload run in separate contexts
      nodeIntegration: false, // no require() in the renderer
      sandbox: true, // OS-level renderer sandbox
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Deny any attempt to open external windows or navigate away from the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Allow the OS to handle truly external links the user explicitly clicks, but
    // never open them inside the app window.
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith('file://') || url.startsWith('http://localhost');
    if (!isLocal) event.preventDefault();
  });

  // Load the built renderer in production, or the dev server when running `dev`.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function applyContentSecurityPolicy(): void {
  // A strict CSP: the renderer may load only its own bundled assets and may not
  // reach the network. There is no remote content in this app.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; " +
            "connect-src 'self'; " +
            "object-src 'none'; " +
            "frame-ancestors 'none'; " +
            "base-uri 'self'",
        ],
      },
    });
  });
}

app.whenReady().then(() => {
  let productName: string;
  try {
    productName = bootSpine().productName;
  } catch (e) {
    // Fail closed: if the spine cannot boot securely (e.g. no OS encryption), show
    // nothing rather than running degraded. Log a code, never PHI.
    log.error('spine_boot_failed', e instanceof Error ? e.message : 'unknown', {
      code: (e as NodeJS.ErrnoException).code ?? null,
    });
    app.quit();
    return;
  }
  applyContentSecurityPolicy();
  createWindow(productName);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(productName);
  });
});

app.on('window-all-closed', () => {
  // Standard desktop behaviour; on Windows the app exits when the window closes.
  if (process.platform !== 'darwin') app.quit();
});
