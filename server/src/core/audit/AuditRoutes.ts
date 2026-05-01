import type { Hono } from 'hono'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { audit_events } from '../../db/schema.js'
import { ok, okPaged } from '../routing/response.js'

export function mountAuditRoutes(app: Hono, basePath = '/audit'): void {
  app.get(basePath, async (ctx) => {
    const { entity, entityId, action, userId, from, to } = ctx.req.query()
    const page     = Math.max(1, Number(ctx.req.query('page')     ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(ctx.req.query('pageSize') ?? 20)))

    const conditions = [
      entity   ? eq(audit_events.entity_type, entity)                  : undefined,
      entityId ? eq(audit_events.entity_id,   Number(entityId))        : undefined,
      action   ? eq(audit_events.action,       action)                  : undefined,
      userId   ? eq(audit_events.user_id,      Number(userId))          : undefined,
      from     ? gte(audit_events.timestamp,   new Date(from))          : undefined,
      to       ? lte(audit_events.timestamp,   new Date(to))            : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[]

    const where = conditions.length ? and(...conditions) : undefined

    const [countRow] = await db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(audit_events)
      .where(where)

    const rows = await db
      .select()
      .from(audit_events)
      .where(where)
      .orderBy(desc(audit_events.timestamp))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    const total = countRow?.total ?? 0
    return ctx.json(okPaged(rows, { total, page, pageSize, hasNext: page * pageSize < total }))
  })

  app.get(`${basePath}/:entityType/:entityId`, async (ctx) => {
    const { entityType, entityId } = ctx.req.param()
    const rows = await db
      .select()
      .from(audit_events)
      .where(and(
        eq(audit_events.entity_type, entityType),
        eq(audit_events.entity_id,   Number(entityId)),
      ))
      .orderBy(desc(audit_events.timestamp))
    return ctx.json(ok(rows))
  })
}
