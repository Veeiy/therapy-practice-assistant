// auditRepository: writes the non-PHI metadata audit trail.
// F4 logging hygiene: `summary` carries counts/ids/byte-sizes only. Never note
// body text, never shorthand, never a prompt or model response. The EgressGuard
// and the notes service both write here.

import type { Database as DB } from 'better-sqlite3-multiple-ciphers';
import type { AuditLogRow } from '@shared/types/domain.js';
import { type Clock, type IdGen } from './support.js';

export class AuditRepository {
  constructor(
    private readonly db: DB,
    private readonly clock: Clock,
    private readonly ids: IdGen
  ) {}

  record(action: string, entity: string, entityId: string | null, summary: string | null): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, entity, entity_id, summary)
         VALUES (@id, @at, 'app', @action, @entity, @entity_id, @summary)`
      )
      .run({
        id: this.ids.next(),
        at: this.clock.nowIso(),
        action,
        entity,
        entity_id: entityId,
        summary,
      });
  }

  recent(limit = 50): AuditLogRow[] {
    return this.db
      .prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?')
      .all(limit) as AuditLogRow[];
  }
}
