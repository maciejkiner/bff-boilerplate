import { sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { ModelBase } from '../model/ModelBase.js'
import type { BuiltForm, FormResult } from './types.js'
import type { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core'

export async function handleForm<
  TInput extends Record<string, unknown>,
  TTable extends PgTableWithColumns<TableConfig>,
  TSelect extends { id: number },
>(
  form: BuiltForm<TInput>,
  model: ModelBase<TTable, TInput, TSelect>,
  payload: unknown,
  id?: number,
): Promise<FormResult<TSelect>> {
  const parsed = form.schema.safeParse(payload)

  if (!parsed.success) {
    return {
      state: 'error',
      errors: flattenZodErrors(parsed.error.issues),
    }
  }

  const data = parsed.data

  // Unique constraint checks
  const uniqueErrors: Record<string, string[]> = {}
  for (const check of form.uniqueChecks) {
    const value = (data as Record<string, unknown>)[check.field]
    const rows = await db.execute(
      sql.raw(`SELECT id FROM ${check.table} WHERE ${check.column} = '${value}' ${id ? `AND id != ${id}` : ''} LIMIT 1`)
    )
    if (rows.length > 0) {
      uniqueErrors[check.field] = [`${check.field} already exists`]
    }
  }

  if (Object.keys(uniqueErrors).length > 0) {
    return { state: 'error', errors: uniqueErrors }
  }

  const saved = await model.save(data, id)

  return { state: id !== undefined ? 'updated' : 'created', data: saved }
}

function flattenZodErrors(issues: { path: (string | number)[]; message: string }[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.join('.') || '_root'
    if (!errors[key]) errors[key] = []
    errors[key].push(issue.message)
  }
  return errors
}
