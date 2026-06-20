// clientsRepository: the only code that writes client SQL.

import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import type {
  Client,
  ClientAddress,
  EmergencyContact,
  PreferredContact,
  ClientStatus,
} from '@shared/types/domain.js';
import { type Clock, type IdGen, parseJson, boolToInt, intToBool } from './support.js';

interface ClientRow {
  id: string;
  legal_first_name: string;
  legal_last_name: string;
  preferred_name: string | null;
  pronouns: string | null;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  preferred_contact_method: PreferredContact;
  address_json: string | null;
  emergency_contact_json: string | null;
  presenting_concern: string | null;
  status: ClientStatus;
  consent_on_file: number;
  consent_date: string | null;
  custom_fields_json: string;
  demo: number;
  created_at: string;
  updated_at: string;
}

function rowToClient(r: ClientRow): Client {
  return {
    id: r.id,
    legal_first_name: r.legal_first_name,
    legal_last_name: r.legal_last_name,
    preferred_name: r.preferred_name,
    pronouns: r.pronouns,
    date_of_birth: r.date_of_birth,
    email: r.email,
    phone: r.phone,
    preferred_contact_method: r.preferred_contact_method,
    address: parseJson<ClientAddress | null>(r.address_json, null),
    emergency_contact: parseJson<EmergencyContact | null>(r.emergency_contact_json, null),
    presenting_concern: r.presenting_concern,
    status: r.status,
    consent_on_file: intToBool(r.consent_on_file),
    consent_date: r.consent_date,
    custom_fields: parseJson<Record<string, unknown>>(r.custom_fields_json, {}),
    demo: r.demo as 0 | 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export interface CreateClientInput {
  legal_first_name: string;
  legal_last_name: string;
  preferred_name?: string | null;
  pronouns?: string | null;
  date_of_birth?: string | null;
  email?: string | null;
  phone?: string | null;
  preferred_contact_method?: PreferredContact;
  presenting_concern?: string | null;
  consent_on_file?: boolean;
  consent_date?: string | null;
  demo?: 0 | 1;
}

export class ClientsRepository {
  constructor(
    private readonly db: DB,
    private readonly clock: Clock,
    private readonly ids: IdGen
  ) {}

  create(input: CreateClientInput): Client {
    const now = this.clock.nowIso();
    const id = this.ids.next();
    this.db
      .prepare(
        `INSERT INTO client
          (id, legal_first_name, legal_last_name, preferred_name, pronouns,
           date_of_birth, email, phone, preferred_contact_method, presenting_concern,
           status, consent_on_file, consent_date, custom_fields_json, demo,
           created_at, updated_at)
         VALUES
          (@id, @first, @last, @preferred, @pronouns, @dob, @email, @phone,
           @contact, @concern, 'active', @consent, @consent_date, '{}', @demo,
           @now, @now)`
      )
      .run({
        id,
        first: input.legal_first_name,
        last: input.legal_last_name,
        preferred: input.preferred_name ?? null,
        pronouns: input.pronouns ?? null,
        dob: input.date_of_birth ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        contact: input.preferred_contact_method ?? 'none',
        concern: input.presenting_concern ?? null,
        consent: boolToInt(input.consent_on_file ?? false),
        consent_date: input.consent_date ?? null,
        demo: input.demo ?? 0,
        now,
      });
    return this.get(id)!;
  }

  get(id: string): Client | null {
    const r = this.db.prepare('SELECT * FROM client WHERE id = ?').get(id) as
      | ClientRow
      | undefined;
    return r ? rowToClient(r) : null;
  }

  list(): Client[] {
    const rows = this.db
      .prepare('SELECT * FROM client ORDER BY legal_last_name, legal_first_name')
      .all() as ClientRow[];
    return rows.map(rowToClient);
  }
}
