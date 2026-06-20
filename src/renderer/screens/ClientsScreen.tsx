// ClientsScreen: a read view of the (synthetic) client list. Full client editing
// belongs to the intake workflow (next wave); this screen proves the data path and
// gives the notes screen something to reference. Every record shown here is the
// obviously-fictional demo data (hard rule 4).

import React, { useEffect, useState } from 'react';
import type { Client } from '../../shared/types/domain.js';

export function ClientsScreen(): React.ReactElement {
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.clients
      .list()
      .then(setClients)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="screen">
      <h2>Clients</h2>
      {error && <div className="banner error">{error}</div>}
      <p className="muted">
        Demo records only. Client intake and editing arrive in the next version.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Pronouns</th>
            <th scope="col">Contact</th>
            <th scope="col">Presenting concern</th>
            <th scope="col">Consent</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td>
                {c.preferred_name ?? c.legal_first_name} {c.legal_last_name}
              </td>
              <td>{c.pronouns ?? ''}</td>
              <td>{c.email ?? c.phone ?? ''}</td>
              <td>{c.presenting_concern ?? ''}</td>
              <td>{c.consent_on_file ? 'on file' : 'not recorded'}</td>
            </tr>
          ))}
          {clients.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No clients.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
