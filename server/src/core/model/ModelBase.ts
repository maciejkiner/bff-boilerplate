import { eq, SQL } from 'drizzle-orm'
import { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core'
import { db } from '../../db/index.js'

export abstract class ModelBase<
  TTable extends PgTableWithColumns<TableConfig>,
  TInsert extends Record<string, unknown>,
  TSelect extends { id: number },
> {
  abstract readonly table: TTable

  async get(id: number): Promise<TSelect | null> {
    const rows = await db
      .select()
      .from(this.table)
      .where(eq((this.table as any)['id'], id))
      .limit(1)
    return (rows[0] as TSelect | undefined) ?? null
  }

  async getByField(field: keyof TSelect & string, value: unknown): Promise<TSelect | null> {
    const col = (this.table as any)[field]
    if (!col) throw new Error(`Unknown field: ${field}`)
    const rows = await db.select().from(this.table).where(eq(col, value)).limit(1)
    return (rows[0] as TSelect | undefined) ?? null
  }

  async getAll(where?: SQL): Promise<TSelect[]> {
    const q = db.select().from(this.table)
    const rows = where ? await q.where(where) : await q
    return rows as TSelect[]
  }

  async save(data: TInsert, id?: number): Promise<TSelect> {
    if (id !== undefined) {
      const rows = await db
        .update(this.table)
        .set(data as any)
        .where(eq((this.table as any)['id'], id))
        .returning()
      const row = rows[0]
      if (!row) throw new Error(`Record ${id} not found`)
      return row as TSelect
    }
    const rows = await db.insert(this.table).values(data as any).returning()
    return rows[0] as TSelect
  }

  async delete(id: number): Promise<void> {
    await db.delete(this.table).where(eq((this.table as any)['id'], id))
  }
}
