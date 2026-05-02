import type { Context, Hono } from 'hono'
import type { FormDefinition } from '../form/types.js'
import { defineForm } from '../form/FormDefinition.js'
import { validateForm } from '../form/validateForm.js'
import { ok, okPaged, fail } from '../routing/response.js'
import { parseListQuery } from '../crud/listQuery.js'
import { SubmissionModel } from './SubmissionModel.js'
import { TRANSITIONS, type FormSubmission, type SubmissionStatus } from './types.js'
import type { WorkflowInstance } from '../workflow/types.js'
import type { AuditLogger } from '../audit/AuditLogger.js'

export abstract class SubmissionResource<TValues extends Record<string, unknown> = Record<string, unknown>> {
  abstract readonly formName: string
  abstract readonly form:     FormDefinition<TValues>
  readonly workflow?:    WorkflowInstance
  protected readonly auditLogger?: AuditLogger

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
    app.get(`${basePath}/:id/transitions`,                             ctx => this.listTransitions(ctx))
    app.post(`${basePath}/:id/transitions/:action`,                    ctx => this.executeTransition(ctx))
    app.get(`${basePath}/:id/branches/:branch/transitions`,            ctx => this.listBranchTransitions(ctx))
    app.post(`${basePath}/:id/branches/:branch/transitions/:action`,   ctx => this.executeBranchTransition(ctx))
    app.post(`${basePath}/:id/assign`,                                 ctx => this.assign(ctx))
  }

  // ── Schema ───────────────────────────────────────────────────────────────────

  async schema(ctx: Context): Promise<Response> {
    const user = ctx.get('user') as { id: number; role: string } | undefined
    const fCtx = user ? { user } : {}
    return ctx.json(ok(this.form.toSchema(fCtx)))
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

  async delete(ctx: Context): Promise<Response> {
    const id  = Number(ctx.req.param('id'))
    const row = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    await this.model.softDelete(id, this.getUserId(ctx))
    return ctx.json(ok(null))
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
    const updated  = await this.model.saveStepData(id, fullData, stepName!)
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
    const updated = await this.model.transition(id, 'archived', this.getUserId(ctx))
    return ctx.json(ok(updated))
  }

  async restore(ctx: Context): Promise<Response> {
    const id  = Number(ctx.req.param('id'))
    // Check including soft-deleted rows
    const row = await this.model.getDeleted(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    if (row.deleted_at) {
      const restored = await this.model.undelete(id)
      return ctx.json(ok(restored))
    }
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

  // ── Workflow transitions ──────────────────────────────────────────────────────

  async listTransitions(ctx: Context): Promise<Response> {
    if (!this.workflow) return ctx.json(fail({ _root: ['No workflow defined for this resource'] }), 400)
    const row = await this.model.get(Number(ctx.req.param('id')))
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    const current   = row.workflow_state ?? this.workflow.initial
    const wfCtx     = this.buildWorkflowContext(ctx, row)
    const available = await this.workflow.availableTransitions(current, wfCtx)
    return ctx.json(ok(available.map(t => ({ name: t.name, label: t.label ?? t.name, to: t.to }))))
  }

  async executeTransition(ctx: Context): Promise<Response> {
    if (!this.workflow) return ctx.json(fail({ _root: ['No workflow defined for this resource'] }), 400)
    const id     = Number(ctx.req.param('id'))
    const action = ctx.req.param('action')!
    const row    = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    const current = row.workflow_state ?? this.workflow.initial
    const wfCtx   = this.buildWorkflowContext(ctx, row)
    const result  = await this.workflow.transition(action, current, wfCtx)
    if (!result.ok) return ctx.json(fail({ _root: [result.message] }), 422)
    // Initialize branch states if the new state has parallel branches
    const initBranches = this.workflow.initBranchStates(result.newState)
    const updated = await this.model.setWorkflowState(id, result.newState, result.assignTo, initBranches)
    await this.auditLogger?.log({ entity_id: id, action: 'transition', user_id: this.getUserId(ctx), payload: { transition: action, from: current, to: result.newState, ...(result.assignTo !== undefined ? { assigned_to: result.assignTo } : {}) } })
    return ctx.json(ok(updated))
  }

  async listBranchTransitions(ctx: Context): Promise<Response> {
    if (!this.workflow) return ctx.json(fail({ _root: ['No workflow defined for this resource'] }), 400)
    const id     = Number(ctx.req.param('id'))
    const branch = ctx.req.param('branch')!
    const row    = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    const branchStates = (row.workflow_branches ?? {}) as Record<string, string>
    const wfCtx        = this.buildWorkflowContext(ctx, row)
    const available    = await this.workflow.availableBranchTransitions(branch, branchStates, wfCtx)
    return ctx.json(ok(available.map(t => ({ name: t.name, label: t.label ?? t.name, to: t.to }))))
  }

  async executeBranchTransition(ctx: Context): Promise<Response> {
    if (!this.workflow) return ctx.json(fail({ _root: ['No workflow defined for this resource'] }), 400)
    const id     = Number(ctx.req.param('id'))
    const branch = ctx.req.param('branch')!
    const action = ctx.req.param('action')!
    const row    = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    const branchStates = (row.workflow_branches ?? {}) as Record<string, string>
    const wfCtx        = this.buildWorkflowContext(ctx, row)
    const result       = await this.workflow.transitionBranch(branch, action, branchStates, wfCtx)
    if (!result.ok) return ctx.json(fail({ _root: [result.message] }), 422)

    if (result.merged) {
      // Merge: fire the main workflow's merge transition
      const current     = row.workflow_state ?? this.workflow.initial
      const mergeResult = await this.workflow.transition(result.mergeTransition, current, wfCtx)
      if (!mergeResult.ok) return ctx.json(fail({ _root: [mergeResult.message] }), 422)
      const initBranches = this.workflow.initBranchStates(mergeResult.newState)
      const updated = await this.model.setWorkflowState(id, mergeResult.newState, mergeResult.assignTo, initBranches)
      await this.auditLogger?.log({ entity_id: id, action: 'branch_merge', user_id: this.getUserId(ctx), payload: { branch, branchAction: action, mergeTransition: result.mergeTransition, newState: mergeResult.newState } })
      return ctx.json(ok(updated))
    }

    const updated = await this.model.setBranchStates(id, result.branchStates)
    await this.auditLogger?.log({ entity_id: id, action: 'branch_transition', user_id: this.getUserId(ctx), payload: { branch, branchAction: action, branchStates: result.branchStates } })
    return ctx.json(ok(updated))
  }

  async assign(ctx: Context): Promise<Response> {
    const id   = Number(ctx.req.param('id'))
    const body = await ctx.req.json()
    const userId: number | null = typeof body?.user_id === 'number' ? body.user_id : null
    const row = await this.model.get(id)
    if (!row || row.form_name !== this.formName) return ctx.json(fail({ _root: ['Not found'] }), 404)
    const updated = await this.model.assignTo(id, userId)
    await this.auditLogger?.log({ entity_id: id, action: 'assign', user_id: this.getUserId(ctx), payload: { assigned_to: userId } })
    return ctx.json(ok(updated))
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────────

  protected getCreatedBy(ctx: Context): number | null {
    return (ctx.get('user') as { id: number } | undefined)?.id ?? null
  }
  protected getUserId(ctx: Context): number | null {
    return (ctx.get('user') as { id: number } | undefined)?.id ?? null
  }

  protected buildWorkflowContext(ctx: Context, row: FormSubmission): import('../workflow/types.js').WorkflowContext {
    const user = ctx.get('user') as { id: number; role: string } | undefined
    return {
      ...(user !== undefined ? { user } : {}),
      submission: row as unknown as Record<string, unknown>,
      data:       row.data,
    }
  }

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
    const updated = await this.model.transition(id, to, this.getUserId(ctx))
    return ctx.json(ok(updated))
  }
}
