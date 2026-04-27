import type { Hono } from 'hono'
import type { BaseCrud } from '../crud/BaseCrud.js'
import type { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core'

type AnyCrud = BaseCrud<PgTableWithColumns<TableConfig>, Record<string, unknown>, { id: number }>
type CrudConstructor = new () => AnyCrud

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

      app.get(base,          ctx => resource.list(ctx))
      app.get(`${base}/:id`, ctx => resource.get(ctx))
      app.post(base,         ctx => resource.create(ctx))
      app.put(`${base}/:id`, ctx => resource.update(ctx))
      app.delete(`${base}/:id`, ctx => resource.delete(ctx))
    }
  }
}
