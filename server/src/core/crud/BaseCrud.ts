import type { Context } from 'hono'
import type { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core'
import type { ModelBase } from '../model/ModelBase.js'
import type { FormDefinition, ValidationContext } from '../form/types.js'
import { handleForm } from '../form/handleForm.js'
import { ok, okPaged, fail } from '../routing/response.js'
import { parseListQuery, type ListQuery } from './listQuery.js'

export abstract class BaseCrud<
  TTable extends PgTableWithColumns<TableConfig>,
  TInput extends Record<string, unknown>,
  TSelect extends { id: number },
> {
  abstract readonly model: ModelBase<TTable, TInput, TSelect>
  abstract readonly form:  FormDefinition<TInput>

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
    await this.afterCreate(result.data, ctx)
    return ctx.json(ok(result.data), 201)
  }

  async update(ctx: Context): Promise<Response> {
    const id     = Number(ctx.req.param('id'))
    const raw    = await ctx.req.json()
    const body   = await this.beforeUpdate(id, raw, ctx)
    const result = await handleForm(this.form, this.model, body, id, this.getValidationContext(ctx))
    if (result.state === 'error') return ctx.json(fail(result.errors), 422)
    await this.afterUpdate(result.data, ctx)
    return ctx.json(ok(result.data))
  }

  async delete(ctx: Context): Promise<Response> {
    const id = Number(ctx.req.param('id'))
    await this.beforeDelete(id, ctx)
    await this.model.delete(id)
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
}
