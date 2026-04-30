import type { Context, Hono } from 'hono'
import type { FormDefinition } from '../form/types.js'
import { defineForm } from '../form/FormDefinition.js'
import { validateForm } from '../form/validateForm.js'
import { ok, okPaged, fail } from '../routing/response.js'
import { parseListQuery } from '../crud/listQuery.js'
import { SubmissionModel } from './SubmissionModel.js'
import { TRANSITIONS, type FormSubmission, type SubmissionStatus } from './types.js'

export abstract class SubmissionResource<TValues extends Record<string, unknown> = Record<string, unknown>> {
  abstract readonly formName: string
  abstract readonly form:     FormDefinition<TValues>

  readonly model = new SubmissionModel()

  mount(app: Hono, basePath: string): void {
    app.get(`${basePath}/schema`,              ctx => this.schema(ctx))
    app.get(basePath,                          ctx => this.list(ctx))
    app.get(`${basePath}/:id`,                 ctx => this.get(ctx))
    app.post(basePath,                         ctx => this.create(ctx))
    app.patch(`${basePath}/:id`,               ctx => this.patch(ctx))
    app.patch(`${basePath}/:id/steps/:step`,   ctx => this.saveStep(ctx))
    app.delete(`${basePath}/:id`,              ctx => this.delete(ctx))
    app.post(`${basePath}/:id/submit`,            ctx => this.submit(ctx))
    app.post(`${basePath}/:id/lock`,              ctx => this.lock(ctx))
    app.post(`${basePath}/:id/archive`,           ctx => this.archive(ctx))
    app.post(`${basePath}/:id/restore`,           ctx => this.restore(ctx))
    app.get(`${basePath}/:id/history`,            ctx => this.history(ctx))
    app.get(`${basePath}/:id/history/:version`,   ctx => this.historyVersion(ctx))
  }

  // ── Schema ───────────────────────────────────────────────────────────────────

  async schema(_ctx: Context): Promise<Response> {
    return _ctx.json(ok(this.form.toSchema()))
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async list(ctx: Context): Promise<Response> {
    const query = parseListQuery(ctx.req.url)
    query.filters.unshift({ field: 'form_name', op: 'eq', value: this.formName })
    const result = await this.model.list(query)
    return ctx.json(okPaged(result.rows, {
      total:    result.total,
      page:     query.page,
      pageSize: query.pageSize,
      hasNext:  query.page * query.pageSize < result.total,
    }))
  }

  async get(ctx: Context): Promise<Response> {
    const row = await this.model.get(Number(ctx.req.param('id')))
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    return ctx.json(ok(row))
  }

  async create(ctx: Context): Promise<Response> {
    const body   = await ctx.req.json()
    const data   = (body?.data ?? body) as Record<string, unknown>
    const result = await validateForm(this.form, data, 'draft')
    if (!result.ok) return ctx.json(fail(result.errors), 422)
    const submission = await this.model.save({
      form_name:  this.formName,
      data:       result.data as Record<string, unknown>,
      created_by: this.getCreatedBy(ctx),
    })
    return ctx.json(ok(submission), 201)
  }

  async patch(ctx: Context): Promise<Response> {
    const id  = Number(ctx.req.param('id'))
    const row = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    if (row.status !== 'draft') return ctx.json(fail({ _root: ['Only draft submissions can be edited'] }), 422)

    const body    = await ctx.req.json()
    const partial = (body?.data ?? body) as Record<string, unknown>
    const merged  = { ...(row.data as object), ...partial }
    const result  = await validateForm(this.form, merged, 'draft')
    if (!result.ok) return ctx.json(fail(result.errors), 422)

    const updated = await this.model.patchData(id, result.data as Record<string, unknown>)
    return ctx.json(ok(updated))
  }

  // ── Wizard step save ──────────────────────────────────────────────────────────

  async saveStep(ctx: Context): Promise<Response> {
    const id       = Number(ctx.req.param('id'))
    const stepName = ctx.req.param('step')

    const row = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    if (row.status !== 'draft') return ctx.json(fail({ _root: ['Only draft submissions can be edited'] }), 422)

    const stepDef = this.form.steps.find(s => s.name === stepName)
    if (!stepDef) return ctx.json(fail({ _root: [`Unknown step: ${stepName}`] }), 404)

    const body      = await ctx.req.json()
    const stepInput = (body?.data ?? body) as Record<string, unknown>

    // Validate only this step's fields using a scoped form definition
    const stepFields = this.form.fields.filter(f => stepDef.fields.includes(f.name))
    const stepForm   = defineForm(stepFields)
    const merged     = { ...(row.data as object), ...stepInput }
    const result     = await validateForm(stepForm as any, merged, 'submit')
    if (!result.ok) return ctx.json(fail(result.errors), 422)

    // Persist: merge all data (not just step fields) and update current_step
    const fullData = { ...(row.data as object), ...(result.data as object) }
    const updated  = await this.model.saveStepData(id, fullData, stepName)
    return ctx.json(ok(updated))
  }

  // ── Status transitions ────────────────────────────────────────────────────────

  async submit(ctx: Context): Promise<Response> {
    return this.transition(ctx, 'draft', 'submitted', async (row) => {
      const result = await validateForm(this.form, row.data, 'submit')
      if (!result.ok) return result.errors
      return null
    })
  }

  async lock(ctx: Context): Promise<Response> {
    return this.transition(ctx, 'submitted', 'locked')
  }

  async archive(ctx: Context): Promise<Response> {
    const id  = Number(ctx.req.param('id'))
    const row = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    const updated = await this.model.transition(id, 'archived')
    return ctx.json(ok(updated))
  }

  async restore(ctx: Context): Promise<Response> {
    return this.transition(ctx, 'archived', 'draft')
  }

  // ── Version history ───────────────────────────────────────────────────────────

  async history(ctx: Context): Promise<Response> {
    const id  = Number(ctx.req.param('id'))
    const row = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    const versions = await this.model.getHistory(id)
    return ctx.json(ok(versions))
  }

  async historyVersion(ctx: Context): Promise<Response> {
    const id      = Number(ctx.req.param('id'))
    const version = Number(ctx.req.param('version'))
    const row     = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    const snap = await this.model.getVersion(id, version)
    if (!snap) return ctx.json(fail({ _root: ['Version not found'] }), 404)
    return ctx.json(ok(snap))
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────────

  protected getCreatedBy(_ctx: Context): number | null { return null }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async transition(
    ctx: Context,
    from: SubmissionStatus,
    to: SubmissionStatus,
    validate?: (row: FormSubmission) => Promise<Record<string, string[]> | null>,
  ): Promise<Response> {
    const id  = Number(ctx.req.param('id'))
    const row = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    if (row.status !== from) {
      return ctx.json(fail({ _root: [`Transition requires status '${from}', current is '${row.status}'`] }), 422)
    }
    if (validate) {
      const errors = await validate(row)
      if (errors) return ctx.json(fail(errors), 422)
    }
    const updated = await this.model.transition(id, to)
    return ctx.json(ok(updated))
  }
}
