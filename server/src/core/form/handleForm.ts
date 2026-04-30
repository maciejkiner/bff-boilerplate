import { sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { ModelBase } from '../model/ModelBase.js'
import type { FormDefinition, FormResult, ValidationContext } from './types.js'
import type { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core'
import { isVisible } from './FormDefinition.js'

export async function handleForm<
  TInput extends Record<string, unknown>,
  TTable extends PgTableWithColumns<TableConfig>,
  TSelect extends { id: number },
>(
  form: FormDefinition<TInput>,
  model: ModelBase<TTable, TInput, TSelect>,
  payload: unknown,
  id?: number,
  validationContext: ValidationContext = 'submit',
): Promise<FormResult<TSelect>> {
  const rawValues = (typeof payload === 'object' && payload !== null ? payload : {}) as Partial<TInput>
  const ctx = { values: rawValues, validationContext }

  // Strip invisible fields from payload before validation
  const stripped: Record<string, unknown> = {}
  for (const field of form.fields) {
    if (!isVisible(field, ctx)) continue
    const key = field.name as string
    if (key in rawValues) stripped[key] = rawValues[key as keyof typeof rawValues]
  }

  const parsed = form.toZodSchema(ctx).safeParse(stripped)

  if (!parsed.success) {
    return { state: 'error', errors: flattenZodErrors(parsed.error.issues) }
  }

  const data = parsed.data

  const uniqueErrors: Record<string, string[]> = {}
  for (const check of form.toUniqueChecks(ctx)) {
    const value = (data as Record<string, unknown>)[check.field]
    const rows = await db.execute(
      sql`SELECT id FROM ${sql.identifier(check.table)} WHERE ${sql.identifier(check.column)} = ${value} ${id ? sql`AND id != ${id}` : sql``} LIMIT 1`
    )
    if (rows.rowCount && rows.rowCount > 0) uniqueErrors[check.field] = [`${check.field} already exists`]
  }

  if (Object.keys(uniqueErrors).length > 0) {
    return { state: 'error', errors: uniqueErrors }
  }

  const crossErrors: Record<string, string[]> = {}
  for (const rule of form.crossFieldRules) {
    const msg = rule.validate(data as Partial<TInput>, ctx)
    if (msg !== null) {
      const key = rule.errorField ?? rule.fields[0] ?? '_root'
      if (!crossErrors[key]) crossErrors[key] = []
      crossErrors[key]!.push(msg)
    }
  }
  if (Object.keys(crossErrors).length > 0) {
    return { state: 'error', errors: crossErrors }
  }

  const saved = await model.save(data, id)
  return { state: id !== undefined ? 'updated' : 'created', data: saved }
}

function flattenZodErrors(issues: { path: (string | number)[]; message: string }[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.join('.') || '_root'
    if (!errors[key]) errors[key] = []
    errors[key]!.push(issue.message)
  }
  return errors
}
