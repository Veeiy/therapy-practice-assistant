// DataModeBadge: an always-visible indicator of whether the app is on synthetic
// demo data or real-client data. In this build it is always 'synthetic'. The badge
// makes the safety posture impossible to miss (hard rules 2 and 4).

import React from 'react';
import type { DataMode } from '../../shared/constants.js';
import { SHORT_NOTICES } from '../../shared/disclaimers.js';

export function DataModeBadge(props: { mode: DataMode }): React.ReactElement {
  const synthetic = props.mode === 'synthetic';
  return (
    <div className={`mode-badge ${synthetic ? 'synthetic' : 'real'}`} title={
      synthetic ? SHORT_NOTICES.syntheticMode : 'Real client data mode.'
    }>
      <span className="dot" />
      {synthetic ? 'Demo data' : 'Real data'}
    </div>
  );
}
