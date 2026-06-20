// DisclaimerGate: the first-run screen (hard rule 3). The user cannot reach any
// workflow until they acknowledge. The copy is the shared DISCLAIMERS text so the
// wording is reviewed in one place. Acknowledgement is recorded in the main process
// (FirstRunStore), not in renderer storage, so it cannot be skipped by clearing the
// browser-side state.

import React from 'react';
import { DISCLAIMERS } from '../../shared/disclaimers.js';

export function DisclaimerGate(props: { onAcknowledge: () => void }): React.ReactElement {
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>{DISCLAIMERS.title}</h1>

        <section>
          <h2>What this is</h2>
          <p>{DISCLAIMERS.productNature}</p>
        </section>

        <section>
          <h2>Your data stays here</h2>
          <p>{DISCLAIMERS.localData}</p>
        </section>

        <section>
          <h2>The writing assistant</h2>
          <p>{DISCLAIMERS.aiBoundary}</p>
        </section>

        <section>
          <h2>Please make a backup</h2>
          <p>{DISCLAIMERS.backupReminder}</p>
        </section>

        <button className="primary" onClick={props.onAcknowledge}>
          {DISCLAIMERS.acknowledgeButton}
        </button>
      </div>
    </div>
  );
}
