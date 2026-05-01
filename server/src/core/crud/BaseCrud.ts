import type { Context } from 'hono'
import type { PgTableWithColumns } from 'drizzle-orm/pg-core'
import type { ModelBase } from '../model/ModelBase.js'
import type { FormDefinition, ValidationContext } from '../form/types.js'
import { handleForm } from '../form/handleForm.js'
import { defineForm } from '../form/FormDefinition.js'
import { validateForm } from '../form/validateForm.js'
import { ok, okPaged, fail } from '../routing/response.js'
import { parseListQuery, type ListQuery } from './listQuery.js'
import type { AuditLogger } from '../audit/AuditLogger.js'

export abstract class BaseCrud<
  TTable extends PgTableWithColumns<any>,
  TInput extends Record<string, unknown>,
  TSelect extends { id: number },
> {
  abstract readonly model: ModelBase<TTable, TInput, TSelect>
  abstract readonly form:  FormDefinition<TInput>
  protected readonly auditLogger?: AuditLogger

  async list(ctx: Context): Promise<Response> {
    const query  = await this.beforeList(parseListQuery(ctx.req.url), ctx)
    const result = await this.model.list(query)
    return ctx.json(okPaged(result.rows, {
      total:    result.total,
      page:     query.page,
      pageSize: query.pageSize,
      hasNext:  query.page * query.pageSize < result.total,
    }))
  }

  async get(ctx: Context): Promise<Response> {
    const id  = Number(ctx.req.param('id'))
    const row = await this.model.get(id)
    if (!row) return ctx.json(fail({ _root: ['Not found'] }), 404)
    return ctx.json(ok(row))
  }

  async create(ctx: Context): Promise<Response> {
    const raw    = await ctx.req.json()
    const body   = await this.beforeCreate(raw, ctx)
    const result = await handleForm(this.form, this.model, body, undefined, this.getValidationContext(ctx))
    if (result.state === 'error') return ctx.json(fail(result.errors), 422)
    const { data: created } = result as { state: 'created'; data: TSelect }
    await this.afterCreate(created, ctx)
    await this.auditLogger?.log({ entity_id: created.id, action: 'create', user_id: this.getUserId(ctx), payload: { after: created } })
    return ctx.json(ok(created), 201)
  }

  async update(ctx: Context): Promise<Response> {
    const id     = Number(ctx.req.param('id'))
    const before = this.auditLogger ? await this.model.get(id) : undefined
    const raw    = await ctx.req.json()
    const body   = await this.beforeUpdate(id, raw, ctx)
    const result = await handleForm(this.form, this.model, body, id, this.getValidationContext(ctx))
    if (result.state === 'error') return ctx.json(fail(result.errors), 422)
    const { data: updated } = result as { state: 'updated'; data: TSelect }
    await this.afterUpdate(updated, ctx)
    await this.auditLogger?.log({ entity_id: id, action: 'update', user_id: this.getUserId(ctx), payload: { before, after: updated } })
    return ctx.json(ok(updated))
  }

  async partialUpdate(ctx: Context): Promise<Response> {
    const id       = Number(ctx.req.param('id'))
    const existing = await this.model.get(id)
    if (!existing) return ctx.json(fail({ _root: ['Not found'] }), 404)

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
    const result = await validateForm(scopedForm as any, merged, this.getValidationContext(ctx), id)
    if (!result.ok) return ctx.json(fail(result.errors), 422)

    const patch  = Object.fromEntries(sentFields.map(f => [f.name, (result.data as Record<string, unknown>)[f.name]]))
    const saved  = await this.model.save(patch as TInput, id)
    await this.afterUpdate(saved, ctx)
    await this.auditLogger?.log({ entity_id: id, action: 'update', user_id: this.getUserId(ctx), payload: { before: existing, patch: sent, after: saved } })
    return ctx.json(ok(saved))
  }

  async delete(ctx: Context): Promise<Response> {
    const id     = Number(ctx.req.param('id'))
    const before = this.auditLogger ? await this.model.get(id) : undefined
    await this.beforeDelete(id, ctx)
    await this.model.delete(id)
    await this.auditLogger?.log({ entity_id: id, action: 'delete', user_id: this.getUserId(ctx), payload: { before } })
    return ctx.json(ok(null))
  }

  async schema(ctx: Context): Promise<Response> {
    return ctx.json(ok(this.form.toSchema()))
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
  protected getUserId(_ctx: Context): number | null { return null }
}
