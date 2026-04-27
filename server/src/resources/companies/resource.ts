import type { Context } from 'hono'
import { BaseCrud } from '../../core/crud/BaseCrud.js'
import { ok } from '../../core/routing/index.js'
import { CompanyModel, type Company, type CompanyInsert } from './model.js'
import { companyForm } from './form.js'
import { companies } from '../../db/schema.js'

export class CompaniesResource extends BaseCrud<typeof companies, CompanyInsert, Company> {
  readonly model = new CompanyModel()
  readonly form  = companyForm

  // Override list to support ?q= search
  override async list(ctx: Context): Promise<Response> {
    const q = ctx.req.query('q')
    const rows = q
      ? await this.model.search(q)
      : await this.model.getAll()
    return ctx.json(ok(rows))
  }
}
