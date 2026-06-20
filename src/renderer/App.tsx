// App: the shell. It does three things:
//   1. gate on the first-run disclaimer (hard rule 3) until acknowledged,
//   2. render a nav rail built from the module registry (functional modules are
//      active; scaffolded ones show a "coming soon" badge),
//   3. show a persistent DATA MODE badge so it is always obvious whether the app is
//      on synthetic demo data or (a future) real-client mode.
//
// The shell holds no PHI logic; each screen calls window.api for its data.

import React, { useEffect, useState } from 'react';
import type { ModuleDescriptor } from '../shared/types/module.js';
import type { DataMode } from '../shared/constants.js';
import { DisclaimerGate } from './components/DisclaimerGate.js';
import { DataModeBadge } from './components/DataModeBadge.js';
import { NotesScreen } from './screens/NotesScreen.js';
import { ClientsScreen } from './screens/ClientsScreen.js';
import { ScheduleScreen } from './screens/ScheduleScreen.js';
import { IntakeScreen } from './screens/IntakeScreen.js';
import { BillingScreen } from './screens/BillingScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';

type ScreenKey = 'notes' | 'clients' | 'scheduling' | 'intake' | 'billing' | 'settings';

export function App(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [modules, setModules] = useState<ModuleDescriptor[]>([]);
  const [dataMode, setDataMode] = useState<DataMode>('synthetic');
  const [screen, setScreen] = useState<ScreenKey>('notes');

  useEffect(() => {
    (async () => {
      const [fr, mods, mode] = await Promise.all([
        window.api.app.firstRunStatus(),
        window.api.app.moduleRegistry(),
        window.api.app.dataMode(),
      ]);
      setAcknowledged(fr.acknowledged);
      setModules(mods);
      setDataMode(mode);
      setReady(true);
    })().catch(() => setReady(true));
  }, []);

  // A5: announce the initial load to assistive tech via a polite live region.
  if (!ready)
    return (
      <div className="loading" role="status" aria-live="polite">
        Loading...
      </div>
    );

  if (!acknowledged) {
    return (
      <DisclaimerGate
        onAcknowledge={async () => {
          await window.api.app.firstRunAcknowledge();
          setAcknowledged(true);
        }}
      />
    );
  }

  const navItems: { key: ScreenKey; label: string; functional: boolean }[] = [
    ...modules.map((m) => ({
      key: m.id as ScreenKey,
      label: m.title,
      functional: m.functional,
    })),
    { key: 'clients', label: 'Clients', functional: true },
    { key: 'settings', label: 'Settings', functional: true },
  ];
  // de-duplicate clients (notes module list already includes nav items)
  const seen = new Set<string>();
  const nav = navItems.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));

  return (
    <div className="app">
      <nav className="rail" aria-label="Practice modules">
        <div className="rail-title">Practice</div>
        {nav.map((i) => (
          <button
            key={i.key}
            className={`rail-item${screen === i.key ? ' active' : ''}`}
            onClick={() => setScreen(i.key)}
            aria-current={screen === i.key ? 'page' : undefined}
            aria-label={
              i.functional ? `Go to ${i.label} screen` : `Go to ${i.label} screen (coming soon)`
            }
          >
            {i.label}
            {!i.functional && (
              <span className="soon" aria-hidden="true">
                soon
              </span>
            )}
          </button>
        ))}
        <div className="rail-spacer" />
        <DataModeBadge mode={dataMode} />
      </nav>

      <main className="content" aria-label="Main content">
        {screen === 'notes' && <NotesScreen />}
        {screen === 'clients' && <ClientsScreen />}
        {screen === 'scheduling' && <ScheduleScreen />}
        {screen === 'intake' && <IntakeScreen />}
        {screen === 'billing' && <BillingScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
