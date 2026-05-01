import { db } from '../../db/index.js'
import { audit_events } from '../../db/schema.js'
import type { AuditEvent } from './types.js'

export class AuditLogger {
  readonly entityType: string

  constructor(entityType: string) {
    this.entityType = entityType
  }

  async log(event: Omit<AuditEvent, 'entity_type'>): Promise<void> {
    await db.insert(audit_events).values({ ...event, entity_type: this.entityType })
  }
}
