// dataStore: the facade that opens the encrypted DB, runs migrations, and exposes
// the typed repositories. This is what the spine and services hold; they never
// touch raw SQL or the cipher pragmas directly.
//
// Constructed two ways:
//  - openDataStore(...) for production (real file path + key from keyManager).
//  - The same function is used by tests with a temp file path and an injected
//    clock/idgen for determinism.

import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import { openEncryptedDb } from './db.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';
import {
  systemClock,
  uuidGen,
  type Clock,
  type IdGen,
} from './repositories/support.js';
import { NotesRepository } from './repositories/notesRepository.js';
import { ClientsRepository } from './repositories/clientsRepository.js';
import { AppointmentsRepository } from './repositories/appointmentsRepository.js';
import { AuditRepository } from './repositories/auditRepository.js';
import { IntakeRepository } from './repositories/intakeRepository.js';
import { RemindersRepository } from './repositories/remindersRepository.js';
import { BillingRepository } from './repositories/billingRepository.js';

export interface DataStore {
  readonly db: DB;
  readonly notes: NotesRepository;
  readonly clients: ClientsRepository;
  readonly appointments: AppointmentsRepository;
  readonly audit: AuditRepository;
  // ── Wave 3 module repositories (same Clock/IdGen injection) ──
  readonly intake: IntakeRepository;
  readonly reminders: RemindersRepository;
  readonly billing: BillingRepository;
  close(): void;
}

export interface OpenDataStoreOptions {
  dbPath: string;
  key: Buffer;
  clock?: Clock;
  ids?: IdGen;
}

export function openDataStore(opts: OpenDataStoreOptions): DataStore {
  const clock = opts.clock ?? systemClock;
  const ids = opts.ids ?? uuidGen;
  const db = openEncryptedDb({ dbPath: opts.dbPath, key: opts.key });
  runMigrations(db, MIGRATIONS);
  return {
    db,
    notes: new NotesRepository(db, clock, ids),
    clients: new ClientsRepository(db, clock, ids),
    appointments: new AppointmentsRepository(db, clock, ids),
    audit: new AuditRepository(db, clock, ids),
    intake: new IntakeRepository(db, clock, ids),
    reminders: new RemindersRepository(db, clock, ids),
    billing: new BillingRepository(db, clock, ids),
    close: () => db.close(),
  };
}
