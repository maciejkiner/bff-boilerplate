import { ilike } from 'drizzle-orm'
import { companies } from '../../db/schema.js'
import { db } from '../../db/index.js'
import { ModelBase } from '../../core/model/ModelBase.js'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

export type Company       = InferSelectModel<typeof companies>
export type CompanyInsert = InferInsertModel<typeof companies>

export class CompanyModel extends ModelBase<typeof companies, CompanyInsert, Company> {
  readonly table = companies

  async search(q: string): Promise<Company[]> {
    return db
      .select()
      .from(companies)
      .where(ilike(companies.name, `%${q}%`))
  }
}
