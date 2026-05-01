export type AuditAction = 'create' | 'update' | 'delete' | 'transition' | string

export interface AuditEvent {
  entity_type: string
  entity_id:   number
  action:      AuditAction
  user_id?:    number | null
  payload?:    Record<string, unknown>
}
