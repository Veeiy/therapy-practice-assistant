// ComingSoonScreen: the placeholder for the scaffolded workflows (intake, billing).
// It is honest about what exists now: the data schema is in place and an AI stub is
// wired on the same egress plumbing, but the workflow UI is next wave. This keeps
// the nav rail complete without pretending a workflow is finished.

import React from 'react';

export function ComingSoonScreen(props: { title: string }): React.ReactElement {
  return (
    <div className="screen coming-soon">
      <h2>{props.title}</h2>
      <div className="soon-card">
        <p>
          This workflow is scaffolded. Its data is already part of the encrypted
          database, and its assistant runs on the same protected path as the notes
          assistant. The screens for {props.title.toLowerCase()} arrive in the next
          version.
        </p>
      </div>
    </div>
  );
}
