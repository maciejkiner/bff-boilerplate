import type { Hono } from 'hono'
import { ok, fail } from '../routing/response.js'
import type { WorkflowInstance } from './types.js'

export class WorkflowRegistry {
  private workflows = new Map<string, WorkflowInstance>()

  register(workflow: WorkflowInstance): this {
    this.workflows.set(workflow.name, workflow)
    return this
  }

  mount(app: Hono, basePath = '/workflows'): void {
    app.get(`${basePath}/:name/graph`, (ctx) => {
      const wf = this.workflows.get(ctx.req.param('name'))
      if (!wf) return ctx.json(fail({ _root: [`Workflow '${ctx.req.param('name')}' not found`] }), 404)
      return ctx.json(ok(wf.toGraph()))
    })

    app.get(basePath, (ctx) => {
      const names = Array.from(this.workflows.keys())
      return ctx.json(ok(names))
    })
  }
}
