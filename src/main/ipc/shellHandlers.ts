// shellHandlers: registers the NON-module, app-level IPC the shell needs:
//   * app:moduleRegistry / app:dataModeGet      nav rail + data-mode badge
//   * firstRun:status / firstRun:acknowledge    disclaimer gate (hard rule 3)
//   * config:get / config:set                   layered config (hard rule 6)
//   * settings:apiKey*                          sealed API key store (go-live prep)
//   * clients:* / appointments:*                shared read access for the shell
//   * backup:export / backup:restore            F6 encrypted backup/restore
//
// Each handler is thin and delegates to a store/service. Backup handlers take a
// passphrase + a path the USER chose in a native file dialog (the renderer asks the
// main process to open the dialog; the renderer never sees the filesystem). Nothing
// here sends anything externally.

import type { IpcRouter } from '@shared/types/ipc.js';
import type {
  ApiKeyStatus,
  SetApiKeyReq,
  BackupExportReq,
  BackupRestoreReq,
  BackupResult,
} from '@shared/types/ipc.js';
import { CHANNELS } from '@shared/constants.js';
import type { DataMode } from '@shared/constants.js';
import { writeFileSync, readFileSync } from 'node:fs';
import type { DataStore } from '@main/data/dataStore.js';
import type { ConfigStore } from '@main/config/configStore.js';
import type { ApiKeyStore } from '@main/secure/apiKeyStore.js';
import type { FirstRunStore } from '@main/firstRun.js';
import type { ModuleHost } from '@main/moduleHost.js';
import { exportEncryptedBackup, restoreEncryptedBackup } from '@main/data/backupService.js';

export interface ShellHandlerDeps {
  store: DataStore;
  config: ConfigStore;
  apiKey: ApiKeyStore;
  firstRun: FirstRunStore;
  host: ModuleHost;
  /** the sanitized `app.enabledModules` allowlist resolved at boot (custom
   * buildout). The nav rail advertises only these; notes is always kept. */
  enabledModules: string[];
  dataMode: () => DataMode;
  /** the live DB key + paths, needed for the F6 backup re-keying. */
  dbKey: Buffer;
  dbPath: string;
  blobDir: string;
}

export function registerShellHandlers(router: IpcRouter, deps: ShellHandlerDeps): void {
  // ── shell ──
  router.handle(CHANNELS.moduleRegistry, () => deps.host.enabledDescriptors(deps.enabledModules));
  router.handle(CHANNELS.dataModeGet, () => deps.dataMode());

  // ── first-run disclaimer gate ──
  router.handle(CHANNELS.firstRunStatus, () => deps.firstRun.status());
  router.handle(CHANNELS.firstRunAcknowledge, () => {
    deps.firstRun.acknowledge();
  });

  // ── config ──
  router.handle(CHANNELS.configGet, (req: { key: string }) => deps.config.get(req.key));
  router.handle(CHANNELS.configSet, (req: { key: string; value: unknown }) => {
    deps.config.set(req.key, req.value);
  });

  // ── shared reads for the shell ──
  router.handle(CHANNELS.clientsList, () => deps.store.clients.list());
  router.handle(CHANNELS.clientsGet, (req: { id: string }) => deps.store.clients.get(req.id));
  router.handle(CHANNELS.appointmentsList, () => deps.store.appointments.list());

  // ── API key (sealed; go-live prep, no real call this build) ──
  router.handle(CHANNELS.apiKeyStatus, (): ApiKeyStatus => ({
    present: deps.apiKey.has(),
    encryptionAvailable: deps.apiKey.encryptionAvailable(),
  }));
  router.handle(CHANNELS.apiKeySet, (req: SetApiKeyReq) => {
    deps.apiKey.set(req.key);
  });
  router.handle(CHANNELS.apiKeyClear, () => {
    deps.apiKey.clear();
  });

  // ── F6 backup / restore ──
  router.handle(CHANNELS.backupExport, (req: BackupExportReq): BackupResult => {
    try {
      const buf = exportEncryptedBackup(
        { dbPath: deps.dbPath, blobDir: deps.blobDir },
        deps.dbKey,
        req.passphrase
      );
      writeFileSync(req.destPath, buf, { mode: 0o600 });
      return { ok: true, bytes: buf.length };
    } catch (e) {
      return {
        ok: false,
        code: (e as NodeJS.ErrnoException).code,
        message: e instanceof Error ? e.message : 'Backup failed.',
      };
    }
  });

  router.handle(CHANNELS.backupRestore, (req: BackupRestoreReq): BackupResult => {
    try {
      const buf = readFileSync(req.srcPath);
      const res = restoreEncryptedBackup(
        buf,
        req.passphrase,
        { dbPath: deps.dbPath, blobDir: deps.blobDir },
        deps.dbKey
      );
      return { ok: true, bytes: res.tables };
    } catch (e) {
      return {
        ok: false,
        code: (e as NodeJS.ErrnoException).code,
        message: e instanceof Error ? e.message : 'Restore failed.',
      };
    }
  });
}
