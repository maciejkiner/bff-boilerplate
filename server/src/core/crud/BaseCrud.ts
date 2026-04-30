import type { Context } from 'hono'
import type { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core'
import type { ModelBase } from '../model/ModelBase.js'
import type { FormDefinition, ValidationContext } from '../form/types.js'
import { handleForm } from '../form/handleForm.js'
import { ok, okPaged, fail } from '../routing/response.js'
import { parseListQuery } from './listQuery.js'

export abstract class BaseCrud<
  TTable extends PgTableWithColumns<TableConfig>,
  TInput extends Record<string, unknown>,
  TSelect extends { id: number },
> {
  abstract readonly model: ModelBase<TTable, TInput, TSelect>
  abstract readonly form:  FormDefinition<TInput>

  async list(ctx: Context): Promise<Response> {
    const query  = parseListQuery(ctx.req.url)
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
    const body   = await ctx.req.json()
    const result = await handleForm(this.form, this.model, body, undefined, this.getValidationContext(ctx))
    if (result.state === 'error') return ctx.json(fail(result.errors), 422)
    return ctx.json(ok(result.data), 201)
  }

  async update(ctx: Context): Promise<Response> {
    const id     = Number(ctx.req.param('id'))
    const body   = await ctx.req.json()
    const result = await handleForm(this.form, this.model, body, id, this.getValidationContext(ctx))
    if (result.state === 'error') return ctx.json(fail(result.errors), 422)
    return ctx.json(ok(result.data))
  }

  protected getValidationContext(_ctx: Context): ValidationContext { return 'submit' }

  async delete(ctx: Context): Promise<Response> {
    const id = Number(ctx.req.param('id'))
    await this.model.delete(id)
    return ctx.json(ok(null))
  }

  async schema(ctx: Context): Promise<Response> {
    return ctx.json(ok(this.form.toFieldMetas()))
  }
}
