import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, lte, ne, sql, SQL } from 'drizzle-orm'
import { PgTableWithColumns } from 'drizzle-orm/pg-core'
import { db as defaultDb } from '../../db/index.js'
import type { FilterClause, ListQuery, SortClause } from '../crud/listQuery.js'
import { logger } from '../../lib/logger.js'

export abstract class ModelBase<
  TTable extends PgTableWithColumns<any>,
  TInsert extends Record<string, unknown>,
  TSelect extends { id: number },
> {
  abstract readonly table: TTable
  protected readonly db: typeof defaultDb

  constructor(db?: typeof defaultDb) {
    this.db = db ?? defaultDb
  }

  async get(id: number): Promise<TSelect | null> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(eq((this.table as any)['id'], id))
      .limit(1)
    return (rows[0] as TSelect | undefined) ?? null
  }

  async getByField(field: keyof TSelect & string, value: unknown): Promise<TSelect | null> {
    const col = (this.table as any)[field]
    if (!col) throw new Error(`Unknown field: ${field}`)
    const rows = await this.db.select().from(this.table).where(eq(col, value)).limit(1)
    return (rows[0] as TSelect | undefined) ?? null
  }

  async getAll(where?: SQL): Promise<TSelect[]> {
    const q = this.db.select().from(this.table)
    const rows = where ? await q.where(where) : await q
    return rows as TSelect[]
  }

  async list(query: ListQuery): Promise<{ rows: TSelect[]; total: number }> {
    const where  = this.buildWhere(query.filters)
    const orders = this.buildOrderBy(query.sort)
    const offset = (query.page - 1) * query.pageSize

    const [countRow] = await this.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(this.table)
      .where(where)

    const rows = await this.db
      .select()
      .from(this.table)
      .where(where)
      .orderBy(...orders)
      .limit(query.pageSize)
      .offset(offset)

    return { rows: rows as TSelect[], total: countRow?.total ?? 0 }
  }

  private buildWhere(filters: FilterClause[]): SQL | undefined {
    const conditions: SQL[] = []
    for (const f of filters) {
      const col = (this.table as any)[f.field]
      if (!col) {
        logger.warn(`[ModelBase] Unknown filter field '${f.field}' — filter ignored`)
        continue
      }
      switch (f.op) {
        case 'eq':     conditions.push(eq(col, f.value));                      break
        case 'neq':    conditions.push(ne(col, f.value));                      break
        case 'like':   conditions.push(like(col, `%${f.value}%`));            break
        case 'gt':     conditions.push(gt(col, f.value));                      break
        case 'gte':    conditions.push(gte(col, f.value));                     break
        case 'lt':     conditions.push(lt(col, f.value));                      break
        case 'lte':    conditions.push(lte(col, f.value));                     break
        case 'isNull': conditions.push(isNull(col));                           break
        case 'in':     if (f.values?.length) conditions.push(inArray(col, f.values)); break
      }
    }
    return conditions.length ? and(...conditions) : undefined
  }

  private buildOrderBy(sort: SortClause[]): SQL[] {
    return sort.flatMap(s => {
      const col = (this.table as any)[s.field]
      if (!col) {
        logger.warn(`[ModelBase] Unknown sort field '${s.field}' — sort ignored`)
        return []
      }
      return [s.dir === 'desc' ? desc(col) : asc(col)]
    })
  }

  async save(data: TInsert, id?: number): Promise<TSelect> {
    if (id !== undefined) {
      const rows = await this.db
        .update(this.table)
        .set(data as any)
        .where(eq((this.table as any)['id'], id))
        .returning()
      const row = rows[0]
      if (!row) throw new Error(`Record ${id} not found`)
      return row as TSelect
    }
    const rows = await this.db.insert(this.table).values(data as any).returning()
    return rows[0] as TSelect
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(this.table).where(eq((this.table as any)['id'], id))
  }

  /** Soft-delete by setting `deleted_at`. Requires a `deleted_at` column on the table. */
  async softDelete(id: number): Promise<void> {
    const col = (this.table as any)['deleted_at']
    if (!col) throw new Error(`${this.constructor.name}: table has no 'deleted_at' column`)
    await this.db.update(this.table).set({ deleted_at: new Date() } as any).where(eq((this.table as any)['id'], id))
  }
}
