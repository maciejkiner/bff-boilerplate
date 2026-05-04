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
  private _resources: Array<{ path: string; Ctor: CrudConstructor }> = []

  register(path: string, Ctor: CrudConstructor): this {
    this._resources.push({ path, Ctor })
    return this
  }

  /** Expose registered resources for OpenAPI generation. */
  getResources(): ReadonlyArray<{ path: string; Ctor: CrudConstructor }> {
    return this._resources
  }

  mount(app: Hono): void {
    const isDev = process.env['NODE_ENV'] !== 'production'

    for (const { path, Ctor } of this._resources) {
      const resource = new Ctor()

      if (isDev && !('policy' in resource && (resource as any).policy != null)) {
        console.warn(`[AuthPolicy] ${Ctor.name} has no policy — all authenticated users have full access`)
      }

      const base = `/${path}`

      // Detect nested pattern: e.g. "companies/:companyId/contacts"
      const nestedMatch = path.match(/^.+\/:([^/]+)\/.+$/)
      const parentParam = nestedMatch?.[1] ?? null

      const wrap = (handler: (ctx: Context) => Promise<Response>) =>
        parentParam
          ? (ctx: Context) => { ;(ctx as any).set('_parentId', Number(ctx.req.param(parentParam))); return handler(ctx) }
          : handler

      app.get(`${base}/schema`,           wrap(ctx => resource.schema(ctx)))
      app.post(`${base}/schema/evaluate`, wrap(ctx => resource.evaluateSchema(ctx)))
      app.get(base,                       wrap(ctx => resource.list(ctx)))
      app.get(`${base}/:id`,              wrap(ctx => resource.get(ctx)))
      app.post(base,                      wrap(ctx => resource.create(ctx)))
      app.post(`${base}/bulk`,            wrap(ctx => resource.bulk(ctx)))
      app.put(`${base}/:id`,              wrap(ctx => resource.update(ctx)))
      app.patch(`${base}/:id`,            wrap(ctx => resource.partialUpdate(ctx)))
      app.delete(`${base}/:id`,           wrap(ctx => resource.delete(ctx)))
    }
  }
}
