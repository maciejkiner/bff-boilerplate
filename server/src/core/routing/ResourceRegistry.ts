import type { Hono } from 'hono'
import type { Context } from 'hono'

interface CrudLike {
  schema(ctx: Context):        Promise<Response>
  list(ctx: Context):          Promise<Response>
  get(ctx: Context):           Promise<Response>
  create(ctx: Context):        Promise<Response>
  update(ctx: Context):        Promise<Response>
  partialUpdate(ctx: Context): Promise<Response>
  delete(ctx: Context):        Promise<Response>
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

      app.get(`${base}/schema`,   ctx => resource.schema(ctx))
      app.get(base,               ctx => resource.list(ctx))
      app.get(`${base}/:id`,      ctx => resource.get(ctx))
      app.post(base,              ctx => resource.create(ctx))
      app.put(`${base}/:id`,      ctx => resource.update(ctx))
      app.patch(`${base}/:id`,    ctx => resource.partialUpdate(ctx))
      app.delete(`${base}/:id`,   ctx => resource.delete(ctx))
    }
  }
}
