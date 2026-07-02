// SetupNotice: a small, dismissible banner shown while no Practice Profile
// exists yet. It replaces the originally specified in-app onboarding gate: the
// setup interview lives in the companion setup plugin (in Claude), so the app
// only NOTICES that setup has not happened and points there, warmly, once.
// It never blocks anything; the app is fully usable on its default settings.

import React from 'react';

export function SetupNotice(props: { onDismiss: () => void }): React.ReactElement {
  return (
    <div className="setup-notice" role="status" aria-live="polite">
      <span className="setup-notice-text">
        Whenever you are ready, the companion setup plugin in Claude can tailor this
        app to your practice, and everything here works with friendly default
        settings in the meantime.
      </span>
      <button
        className="setup-notice-dismiss"
        onClick={props.onDismiss}
        aria-label="Dismiss the setup notice"
      >
        Got it
      </button>
    </div>
  );
}
