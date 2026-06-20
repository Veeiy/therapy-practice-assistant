// SettingsScreen: the operator-facing controls.
//   * DATA MODE indicator + plain explanation of what synthetic mode means.
//   * API KEY entry: stores an Anthropic key SEALED by the OS keystore. This is
//     GO-LIVE PREP only. The key is never used to make a real call in this build
//     (real egress is gated off); a clear notice says so. The app never types the
//     key into any external field; it only seals what the operator enters here.
//   * ENCRYPTED BACKUP / RESTORE (F6): passphrase-protected. The user picks a file
//     location through a main-process dialog; the renderer never sees the
//     filesystem. A wrong passphrase fails with a clear message.
//
// Note: the key field is masked and never echoed back. status() only reports
// whether a key is present, never the value.

import React, { useEffect, useState } from 'react';
import type { DataMode } from '../../shared/constants.js';
import { SHORT_NOTICES } from '../../shared/disclaimers.js';

export function SettingsScreen(): React.ReactElement {
  const [mode, setMode] = useState<DataMode>('synthetic');
  const [keyPresent, setKeyPresent] = useState(false);
  const [encAvailable, setEncAvailable] = useState(true);
  const [keyInput, setKeyInput] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    const [m, ks] = await Promise.all([
      window.api.app.dataMode(),
      window.api.settings.apiKeyStatus(),
    ]);
    setMode(m);
    setKeyPresent(ks.present);
    setEncAvailable(ks.encryptionAvailable);
  };

  useEffect(() => {
    refresh().catch((e) => setMsg(String(e)));
  }, []);

  const saveKey = async () => {
    setMsg(null);
    try {
      await window.api.settings.apiKeySet({ key: keyInput });
      setKeyInput('');
      await refresh();
      setMsg('API key stored securely on this computer. It is not used for real client data in this version.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not store the key.');
    }
  };

  const clearKey = async () => {
    setMsg(null);
    try {
      await window.api.settings.apiKeyClear();
      await refresh();
      setMsg('API key removed.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not remove the key.');
    }
  };

  return (
    <div className="screen settings-screen">
      <h2>Settings</h2>
      {msg && <div className="banner info">{msg}</div>}

      <section className="card">
        <h3>Data mode</h3>
        <p>
          Current mode: <strong>{mode === 'synthetic' ? 'Demo data' : 'Real data'}</strong>
        </p>
        <p className="muted">{SHORT_NOTICES.syntheticMode}</p>
        <p className="muted">{SHORT_NOTICES.realModeBlocked}</p>
      </section>

      <section className="card">
        <h3>AI assistant key (advanced, go-live preparation)</h3>
        <p className="muted">
          You can store an Anthropic API key here for the future. It is encrypted on
          this computer using your Windows account. In this version the assistant
          never sends real client information, so this key is not used for real data
          yet. The practice owner turns real use on later, only after signing a
          Business Associate Agreement with the AI provider.
        </p>
        {!encAvailable && (
          <div className="banner error">
            Secure storage is not available on this computer, so a key cannot be
            stored safely. Please contact support before continuing.
          </div>
        )}
        <p>
          Status: <strong>{keyPresent ? 'A key is stored' : 'No key stored'}</strong>
        </p>
        <div className="row">
          <input
            type="password"
            placeholder="Paste an Anthropic API key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoComplete="off"
          />
          <button onClick={saveKey} disabled={!keyInput.trim() || !encAvailable}>
            Store key
          </button>
          {keyPresent && (
            <button className="danger-outline" onClick={clearKey}>
              Remove key
            </button>
          )}
        </div>
      </section>

      <BackupCard onMessage={setMsg} />
    </div>
  );
}

// BackupCard: F6 encrypted backup + restore. The file path is chosen in the main
// process; here we accept a path the user typed/selected and a passphrase. (In the
// packaged app the "Choose file" buttons call a native dialog over IPC; this build
// keeps the path as a text field so the flow is exercisable without the dialog.)
function BackupCard(props: { onMessage: (m: string) => void }): React.ReactElement {
  const [pass, setPass] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const res = await window.api.backup.export({ passphrase: pass, destPath: path });
      props.onMessage(
        res.ok
          ? `Encrypted backup written (${res.bytes} bytes). Keep your passphrase safe; it cannot be recovered.`
          : `Backup failed: ${res.message ?? res.code ?? 'unknown error'}`
      );
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    setBusy(true);
    try {
      const res = await window.api.backup.restore({ passphrase: pass, srcPath: path });
      props.onMessage(
        res.ok
          ? "Backup restored into this computer's encrypted database."
          : `Restore failed: ${res.message ?? res.code ?? 'unknown error'}`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3>Encrypted backup and restore</h3>
      <p className="muted">
        Create a passphrase-protected backup you can store somewhere safe, or restore
        one onto this computer. The backup is encrypted with your passphrase, so it
        can move between computers. If you forget the passphrase, the backup cannot be
        opened.
      </p>
      <div className="row">
        <input
          type="text"
          placeholder="Backup file path (e.g. D:\\practice-backup.tpabackup)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
      <div className="row">
        <input
          type="password"
          placeholder="Backup passphrase (at least 8 characters)"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoComplete="off"
        />
        <button onClick={doExport} disabled={busy || !pass || !path}>
          Create backup
        </button>
        <button className="danger-outline" onClick={doRestore} disabled={busy || !pass || !path}>
          Restore backup
        </button>
      </div>
    </section>
  );
}
