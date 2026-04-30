import { sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { isVisible } from './FormDefinition.js'
import type { FormDefinition, ValidationContext } from './types.js'

export type ValidationResult<T> =
  | { ok: true;  data: T }
  | { ok: false; errors: Record<string, string[]> }

export async function validateForm<TInput extends Record<string, unknown>>(
  form: FormDefinition<TInput>,
  payload: unknown,
  validationContext: ValidationContext = 'submit',
  excludeId?: number,
): Promise<ValidationResult<TInput>> {
  const rawValues = (typeof payload === 'object' && payload !== null ? payload : {}) as Partial<TInput>
  const ctx = { values: rawValues, validationContext }

  const stripped: Record<string, unknown> = {}
  for (const field of form.fields) {
    if (!isVisible(field, ctx)) continue
    const key = field.name as string
    if (key in rawValues) {
      stripped[key] = rawValues[key as keyof typeof rawValues]
    } else if (field.defaultValue !== undefined) {
      stripped[key] = typeof field.defaultValue === 'function'
        ? (field.defaultValue as (c: typeof ctx) => unknown)(ctx)
        : field.defaultValue
    }
  }

  const parsed = form.toZodSchema(ctx).safeParse(stripped)
  if (!parsed.success) return { ok: false, errors: flattenZodErrors(parsed.error.issues) }

  const data = parsed.data

  for (const check of form.toUniqueChecks(ctx)) {
    const value = (data as Record<string, unknown>)[check.field]
    const rows = await db.execute(
      sql`SELECT id FROM ${sql.identifier(check.table)} WHERE ${sql.identifier(check.column)} = ${value} ${excludeId ? sql`AND id != ${excludeId}` : sql``} LIMIT 1`
    )
    if (rows.rowCount && rows.rowCount > 0) {
      return { ok: false, errors: { [check.field]: [`${check.field} already exists`] } }
    }
  }

  for (const rule of form.crossFieldRules) {
    const msg = rule.validate(data as Partial<TInput>, ctx)
    if (msg !== null) {
      const key = rule.errorField ?? rule.fields[0] ?? '_root'
      return { ok: false, errors: { [key]: [msg] } }
    }
  }

  return { ok: true, data }
}

export function flattenZodErrors(
  issues: { path: (string | number)[]; message: string }[],
): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.join('.') || '_root'
    if (!errors[key]) errors[key] = []
    errors[key]!.push(issue.message)
  }
  return errors
}
