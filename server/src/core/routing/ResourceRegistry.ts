import type { Hono } from 'hono'
import type { Context } from 'hono'

interface CrudLike {
  schema(ctx: Context):         Promise<Response>
  evaluateSchema(ctx: Context): Promise<Response>
  list(ctx: Context):           Promise<Response>
  get(ctx: Context):            Promise<Response>
  create(ctx: Context):         Promise<Response>
  update(ctx: Context):         Promise<Response>
  partialUpdate(ctx: Context):  Promise<Response>
  delete(ctx: Context):         Promise<Response>
  bulk(ctx: Context):           Promise<Response>
}
type CrudConstructor = new () => CrudLike

export class ResourceRegistry {
  private resources: Array<{ path: string; Ctor: CrudConstructor }> = []

  register(path: string, Ctor: CrudConstructor): this {
    this.resources.push({ path, Ctor })
    return this
  }

  mount(app: Hono): void {
    for (const { path, Ctor } of this.resources) {
      const resource = new Ctor()
      const base = `/${path}`

      // Detect nested pattern: e.g. "companies/:companyId/contacts"
      const nestedMatch = path.match(/^.+\/:([^/]+)\/.+$/)
      const parentParam = nestedMatch?.[1] ?? null

      const wrap = (handler: (ctx: Context) => Promise<Response>) =>
        parentParam
          ? (ctx: Context) => { ;(ctx as any).set('_parentId', Number(ctx.req.param(parentParam))); return handler(ctx) }
          : handler

      app.get(`${base}/schema`,         wrap(ctx => resource.schema(ctx)))
      app.post(`${base}/schema/evaluate`, wrap(ctx => resource.evaluateSchema(ctx)))
      app.get(base,               wrap(ctx => resource.list(ctx)))
      app.get(`${base}/:id`,      wrap(ctx => resource.get(ctx)))
      app.post(base,              wrap(ctx => resource.create(ctx)))
      app.post(`${base}/bulk`,    wrap(ctx => resource.bulk(ctx)))
      app.put(`${base}/:id`,      wrap(ctx => resource.update(ctx)))
      app.patch(`${base}/:id`,    wrap(ctx => resource.partialUpdate(ctx)))
      app.delete(`${base}/:id`,   wrap(ctx => resource.delete(ctx)))
    }
  }
}
