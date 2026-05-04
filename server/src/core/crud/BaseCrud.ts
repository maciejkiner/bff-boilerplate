import type { Context } from 'hono'
import type { PgTableWithColumns } from 'drizzle-orm/pg-core'
import type { ModelBase } from '../model/ModelBase.js'
import type { FormContext, FormDefinition, ValidationContext } from '../form/types.js'
import type { AuthUser } from '../../middleware/auth.js'
import { AuthPolicy } from '../auth/AuthPolicy.js'
import { handleForm } from '../form/handleForm.js'
import { defineForm } from '../form/FormDefinition.js'
import { validateForm } from '../form/validateForm.js'
import { ok, okPaged, fail } from '../routing/response.js'
import { parseListQuery, type ListQuery } from './listQuery.js'
import type { AuditLogger } from '../audit/AuditLogger.js'
import { logger } from '../../lib/logger.js'
import { db } from '../../db/index.js'

const BULK_MAX = 100

export abstract class BaseCrud<
  TTable extends PgTableWithColumns<any>,
  TInput extends Record<string, unknown>,
  TSelect extends { id: number },
> {
  abstract readonly model: ModelBase<TTable, TInput, TSelect>
  abstract readonly form:  FormDefinition<TInput>
  protected readonly auditLogger?: AuditLogger
  protected readonly policy?: AuthPolicy
  /** Set to true to soft-delete via `deleted_at` instead of hard-deleting. Requires `deleted_at` on the table. */
  protected readonly softDelete: boolean = false

  /** DB column name for parent FK when mounted as a nested resource, e.g. `'company_id'` */
  protected readonly parentField?: string

  private deny(ctx: Context): Response {
    return ctx.json(fail({ _root: ['Forbidden'] }), 403)
  }

  async list(ctx: Context): Promise<Response> {
    const user = this.getUser(ctx) as AuthUser | undefined
    if (this.policy && !this.policy.canList(user)) return this.deny(ctx)
    const fCtx     = this.buildFormContext(ctx)
    const fields   = this.parseFields(ctx)
    const raw      = parseListQuery(ctx.req.url)
    let   pruned   = this.pruneListQuery(raw)

    const parentId = this.getParentId(ctx)
    if (parentId !== null && this.parentField) {
      if (!await this.parentExists(parentId, ctx)) return ctx.json(fail({ _root: ['Parent not found'] }), 404)
      pruned = { ...pruned, filters: [{ field: this.parentField, op: 'eq', value: String(parentId) }, ...pruned.filters] }
    }

    const query  = await this.beforeList(pruned, ctx)
    const result = await this.model.list(query)
    const rows   = result.rows.map(row => this.shapeOutput(this.form.toRedacted(row, fCtx), fields))
    return ctx.json(okPaged(rows, {
      total:    result.total,
      page:     query.page,
      pageSize: query.pageSize,
      hasNext:  query.page * query.pageSize < result.total,
    }))
  }

  async get(ctx: Context): Promise<Response> {
    const user   = this.getUser(ctx) as AuthUser | undefined
    const id     = Number(ctx.req.param('id'))
    const fields = this.parseFields(ctx)
    const row    = await this.model.get(id)
    if (!row) return ctx.json(fail({ _root: ['Not found'] }), 404)
    if (this.policy && !this.policy.canRead(user, row as Record<string, unknown>)) return this.deny(ctx)
    return ctx.json(ok(this.shapeOutput(this.form.toRedacted(row, this.buildFormContext(ctx)), fields)))
  }

  async create(ctx: Context): Promise<Response> {
    const user     = this.getUser(ctx)
    if (this.policy && !this.policy.canCreate(user as AuthUser | undefined)) return this.deny(ctx)
    const fields   = this.parseFields(ctx)
    const raw      = await ctx.req.json()
    let   body     = await this.beforeCreate(raw, ctx)
    const parentId = this.getParentId(ctx)
    if (parentId !== null && this.parentField) {
      if (!await this.parentExists(parentId, ctx)) return ctx.json(fail({ _root: ['Parent not found'] }), 404)
      body = { ...(typeof body === 'object' && body !== null ? (body as object) : {}), [this.parentField]: parentId }
    }
    const result = await handleForm(this.form, this.model, body, undefined, this.getValidationContext(ctx), user)
    if (result.state === 'error') return ctx.json(fail(result.errors), 422)
    const { data: created } = result as { state: 'created'; data: TSelect }
    await this.afterCreate(created, ctx)
    void this.auditLogger?.log({ entity_id: created.id, action: 'create', user_id: user?.id ?? null, payload: { after: created } }).catch(e => logger.error({ err: e }, '[audit] log failed'))
    return ctx.json(ok(this.shapeOutput(this.form.toRedacted(created, this.buildFormContext(ctx)), fields)), 201)
  }

  async update(ctx: Context): Promise<Response> {
    const id     = Number(ctx.req.param('id'))
    const user   = this.getUser(ctx)
    const fields = this.parseFields(ctx)
    const before = this.policy || this.auditLogger ? await this.model.get(id) : undefined
    if (before === null) return ctx.json(fail({ _root: ['Not found'] }), 404)
    if (this.policy && before && !this.policy.canUpdate(user as AuthUser | undefined, before as Record<string, unknown>)) return this.deny(ctx)
    const raw    = await ctx.req.json()
    // Optimistic locking: if caller sends _version, compare with stored record
    if (raw !== null && typeof raw === 'object' && '_version' in raw) {
      const stored = before ?? await this.model.get(id)
      const storedVersion = (stored as Record<string, unknown> | null)?.['version']
      if (storedVersion !== undefined && storedVersion !== raw['_version']) {
        return ctx.json(fail({ _root: ['Record was modified by another request — refresh and retry'] }), 409)
      }
    }
    const body   = await this.beforeUpdate(id, raw, ctx)
    const result = await handleForm(this.form, this.model, body, id, this.getValidationContext(ctx), user)
    if (result.state === 'error') return ctx.json(fail(result.errors), 422)
    const { data: updated } = result as { state: 'updated'; data: TSelect }
    await this.afterUpdate(updated, ctx)
    void this.auditLogger?.log({ entity_id: id, action: 'update', user_id: user?.id ?? null, payload: { before, after: updated } }).catch(e => logger.error({ err: e }, '[audit] log failed'))
    return ctx.json(ok(this.shapeOutput(this.form.toRedacted(updated, this.buildFormContext(ctx)), fields)))
  }

  async partialUpdate(ctx: Context): Promise<Response> {
    const id       = Number(ctx.req.param('id'))
    const user     = this.getUser(ctx)
    const fields   = this.parseFields(ctx)
    const existing = await this.model.get(id)
    if (!existing) return ctx.json(fail({ _root: ['Not found'] }), 404)
    if (this.policy && !this.policy.canUpdate(user as AuthUser | undefined, existing as Record<string, unknown>)) return this.deny(ctx)

    const raw  = await ctx.req.json()
    const body = await this.beforeUpdate(id, raw, ctx)
    const sent = typeof body === 'object' && body !== null ? body : {}

    // Scope validation to sent fields only; preserve cross-field rules whose
    // fields are entirely present in the payload.
    const sentKeys   = new Set(Object.keys(sent))
    const sentFields = this.form.fields.filter(f => sentKeys.has(f.name))
    const sentRules  = this.form.crossFieldRules.filter(r => r.fields.every(f => sentKeys.has(f)))
    const scopedForm = defineForm(sentFields, { rules: sentRules })

    const merged = { ...(existing as Record<string, unknown>), ...(sent as Record<string, unknown>) }
    const result = await validateForm(scopedForm as any, merged, this.getValidationContext(ctx), { excludeId: id, ...(user ? { user } : {}) })
    if (!result.ok) return ctx.json(fail(result.errors), 422)

    const patch  = Object.fromEntries(sentFields.map(f => [f.name, (result.data as Record<string, unknown>)[f.name]]))
    const saved  = await this.model.save(patch as TInput, id)
    await this.afterUpdate(saved, ctx)
    void this.auditLogger?.log({ entity_id: id, action: 'update', user_id: user?.id ?? null, payload: { before: existing, patch: sent, after: saved } }).catch(e => logger.error({ err: e }, '[audit] log failed'))
    return ctx.json(ok(this.shapeOutput(this.form.toRedacted(saved, this.buildFormContext(ctx)), fields)))
  }

  async delete(ctx: Context): Promise<Response> {
    const id   = Number(ctx.req.param('id'))
    const user = this.getUser(ctx)
    const row  = await this.model.get(id)
    if (!row) return ctx.json(fail({ _root: ['Not found'] }), 404)
    if (this.policy && !this.policy.canDelete(user as AuthUser | undefined, row as Record<string, unknown>)) return this.deny(ctx)
    await this.beforeDelete(id, ctx)
    if (this.softDelete) {
      await this.model.softDelete(id)
    } else {
      await this.model.delete(id)
    }
    void this.auditLogger?.log({ entity_id: id, action: 'delete', user_id: user?.id ?? null, payload: { before: row } }).catch(e => logger.error({ err: e }, '[audit] log failed'))
    return new Response(null, { status: 204 })
  }

  async schema(ctx: Context): Promise<Response> {
    return ctx.json(ok(this.form.toSchema(this.buildFormContext(ctx))))
  }

  async evaluateSchema(ctx: Context): Promise<Response> {
    const body   = await ctx.req.json()
    const values = (typeof body?.values === 'object' && body.values !== null ? body.values : {}) as Partial<TInput>
    const user   = this.getUser(ctx)
    const fCtx: Partial<FormContext<TInput>> = { values, ...(user ? { user } : {}) }
    return ctx.json(ok(this.form.toSchema(fCtx)))
  }

  async bulk(ctx: Context): Promise<Response> {
    const body = await ctx.req.json()
    const ops: unknown[] = Array.isArray(body?.operations) ? body.operations : []
    if (!ops.length)        return ctx.json(fail({ _root: ['No operations provided'] }), 422)
    if (ops.length > BULK_MAX) return ctx.json(fail({ _root: [`Max ${BULK_MAX} operations per request`] }), 422)

    const user    = this.getUser(ctx)
    const vCtx    = this.getValidationContext(ctx)
    const results: unknown[] = []

    // Validate all operations first — abort on first error (all-or-nothing)
    type Op = { op: string; id?: number; data?: unknown }
    const parsed: Op[] = []
    for (let i = 0; i < ops.length; i++) {
      const entry = ops[i] as Op
      if (!entry?.op) return ctx.json(fail({ _root: [`Operation ${i}: missing 'op' field`] }), 422)
      if ((entry.op === 'create' || entry.op === 'update') && !entry.data) {
        return ctx.json(fail({ _root: [`Operation ${i}: 'data' required for '${entry.op}'`] }), 422)
      }
      if ((entry.op === 'update' || entry.op === 'delete') && entry.id === undefined) {
        return ctx.json(fail({ _root: [`Operation ${i}: 'id' required for '${entry.op}'`] }), 422)
      }
      if (!['create', 'update', 'delete'].includes(entry.op)) {
        return ctx.json(fail({ _root: [`Operation ${i}: unknown op '${entry.op}'`] }), 422)
      }
      parsed.push(entry)
    }

    // Execute all operations in a single transaction — truly all-or-nothing
    try {
      await db.transaction(async () => {
        for (const entry of parsed) {
          if (entry.op === 'create') {
            const body = await this.beforeCreate(entry.data, ctx)
            const result = await handleForm(this.form, this.model, body, undefined, vCtx, user)
            if (result.state === 'error') throw Object.assign(new Error('validation'), { validationErrors: result.errors })
            const { data: created } = result as { state: 'created'; data: TSelect }
            await this.afterCreate(created, ctx)
            void this.auditLogger?.log({ entity_id: created.id, action: 'create', user_id: user?.id ?? null, payload: { after: created } }).catch(e => logger.error({ err: e }, '[audit] log failed'))
            results.push({ op: 'create', data: created })
          } else if (entry.op === 'update') {
            const id   = entry.id!
            const body = await this.beforeUpdate(id, entry.data, ctx)
            const result = await handleForm(this.form, this.model, body, id, vCtx, user)
            if (result.state === 'error') throw Object.assign(new Error('validation'), { validationErrors: result.errors })
            const { data: updated } = result as { state: 'updated'; data: TSelect }
            await this.afterUpdate(updated, ctx)
            void this.auditLogger?.log({ entity_id: id, action: 'update', user_id: user?.id ?? null, payload: { after: updated } }).catch(e => logger.error({ err: e }, '[audit] log failed'))
            results.push({ op: 'update', data: updated })
          } else {
            const id  = entry.id!
            const row = await this.model.get(id)
            if (!row) throw Object.assign(new Error('not_found'), { notFoundId: id })
            await this.beforeDelete(id, ctx)
            await this.model.delete(id)
            void this.auditLogger?.log({ entity_id: id, action: 'delete', user_id: user?.id ?? null, payload: { before: row } }).catch(e => logger.error({ err: e }, '[audit] log failed'))
            results.push({ op: 'delete', id })
          }
        }
      })
    } catch (err) {
      if (err instanceof Error && 'validationErrors' in err) {
        return ctx.json(fail((err as Error & { validationErrors: Record<string, string[]> }).validationErrors), 422)
      }
      if (err instanceof Error && 'notFoundId' in err) {
        return ctx.json(fail({ _root: [`Record ${(err as Error & { notFoundId: number }).notFoundId} not found`] }), 404)
      }
      throw err
    }

    return ctx.json(ok(results))
  }

  // ── Lifecycle hooks ────────────────────────────────────────────────────────
  // Override these in a resource subclass to inject behaviour at each stage.
  // before* hooks receive and return data — return a modified copy to transform
  // the payload. Throw an Error (or use ctx.json + return) to abort.

  protected async beforeList(query: ListQuery, _ctx: Context):              Promise<ListQuery> { return query }
  protected async beforeCreate(body: unknown,  _ctx: Context):              Promise<unknown>   { return body  }
  protected async afterCreate(_record: TSelect, _ctx: Context):             Promise<void>      {}
  protected async beforeUpdate(_id: number, body: unknown, _ctx: Context):  Promise<unknown>   { return body  }
  protected async afterUpdate(_record: TSelect, _ctx: Context):             Promise<void>      {}
  protected async beforeDelete(_id: number, _ctx: Context):                 Promise<void>      {}

  protected getValidationContext(_ctx: Context): ValidationContext { return 'submit' }

  protected getUser(ctx: Context): FormContext<TInput>['user'] {
    return ctx.get('user') as FormContext<TInput>['user']
  }

  protected getUserId(ctx: Context): number | null {
    return this.getUser(ctx)?.id ?? null
  }

  protected buildFormContext(ctx: Context): Partial<FormContext<TInput>> {
    const user = this.getUser(ctx)
    return user ? { user } : {}
  }

  protected pruneListQuery(query: ListQuery): ListQuery {
    const filterable = new Set(this.form.fields.filter(f => f.type !== 'computed' && f.type !== 'group' && f.filterable).map(f => f.name))
    const sortable   = new Set(this.form.fields.filter(f => f.type !== 'computed' && f.type !== 'group' && f.sortable).map(f => f.name))
    const baseFilters = query.filters.filter(f => filterable.has(f.field))
    const softDeleteFilter: typeof query.filters = this.softDelete
      ? [{ field: 'deleted_at', op: 'isNull', value: '' }]
      : []
    return {
      ...query,
      filters: [...softDeleteFilter, ...baseFilters],
      sort:    query.sort.filter(s => sortable.has(s.field)),
    }
  }

  protected getParentId(ctx: Context): number | null {
    const pid = (ctx as any).get('_parentId') as number | undefined
    return pid ?? null
  }

  protected async parentExists(_parentId: number, _ctx: Context): Promise<boolean> {
    return true
  }

  protected parseFields(ctx: Context): Set<string> | null {
    const raw = new URLSearchParams(ctx.req.url.split('?')[1] ?? '').get('fields')
    if (!raw) return null
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean))
  }

  protected shapeOutput(data: unknown, fields: Set<string> | null): unknown {
    if (!fields) return data
    if (Array.isArray(data)) return data.map(item => this.shapeOutput(item, fields))
    if (typeof data === 'object' && data !== null) {
      return Object.fromEntries(
        Object.entries(data as Record<string, unknown>).filter(([k]) => fields.has(k))
      )
    }
    return data
  }
}
