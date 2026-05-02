import { sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { isVisible, isEditable } from './FormDefinition.js'
import { defaultMessages, interpolate } from './messages.js'
import { validators as validatorRegistry } from '../validators/index.js'
import type { FormContext, FormDefinition, ValidationContext } from './types.js'

export type ValidationResult<T> =
  | { ok: true;  data: T }
  | { ok: false; errors: Record<string, string[]> }

export interface ValidateFormOptions<TInput> {
  excludeId?: number
  user?:      FormContext<TInput>['user']
}

export async function validateForm<TInput extends Record<string, unknown>>(
  form: FormDefinition<TInput>,
  payload: unknown,
  validationContext: ValidationContext = 'submit',
  options?: ValidateFormOptions<TInput> | number,
): Promise<ValidationResult<TInput>> {
  const opts: ValidateFormOptions<TInput> = typeof options === 'number' ? { excludeId: options } : (options ?? {})
  const excludeId = opts.excludeId
  const rawValues = (typeof payload === 'object' && payload !== null ? payload : {}) as Partial<TInput>
  const ctx: FormContext<TInput> = {
    values: rawValues,
    validationContext,
    ...(opts.user ? { user: opts.user } : {}),
  }

  const stripped: Record<string, unknown> = {}
  for (const field of form.fields) {
    if (field.type === 'computed') continue
    if (!isVisible(field, ctx)) continue
    if (!isEditable(field, ctx)) continue
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
    if (rows.length > 0) {
      const msg = form.translate?.('unique', { field: check.field })
        ?? interpolate(defaultMessages.unique, { field: check.field })
      return { ok: false, errors: { [check.field]: [msg] } }
    }
  }

  for (const rule of form.crossFieldRules) {
    const msg = rule.validate(data as Partial<TInput>, ctx)
    if (msg !== null) {
      const key = rule.errorField ?? rule.fields[0] ?? '_root'
      return { ok: false, errors: { [key]: [msg] } }
    }
  }

  // Named validators from registry (e.g. 'nip', 'pesel')
  const namedErrors: Record<string, string[]> = {}
  for (const field of form.fields) {
    if (field.type === 'computed' || field.type === 'group') continue
    if (!isVisible(field, ctx)) continue
    const named = (field as { validators?: string[] }).validators
    if (!named?.length) continue
    const value = (data as Record<string, unknown>)[field.name as string]
    if (value === undefined || value === null || value === '') continue
    for (const name of named) {
      const fn = validatorRegistry.get(name)
      if (!fn) continue
      const msg = await fn(value)
      if (msg) (namedErrors[field.name as string] ??= []).push(msg)
    }
  }
  if (Object.keys(namedErrors).length) return { ok: false, errors: namedErrors }

  if (form.asyncValidators.length > 0) {
    const results = await Promise.all(
      form.asyncValidators.map(async (v) => {
        const value = v.field === '_root'
          ? data
          : (data as Record<string, unknown>)[v.field]
        const msg = await v.validate(value, ctx)
        return msg ? { field: v.field as string, msg } : null
      }),
    )
    const asyncErrors: Record<string, string[]> = {}
    for (const r of results) {
      if (!r) continue
      ;(asyncErrors[r.field] ??= []).push(r.msg)
    }
    if (Object.keys(asyncErrors).length) return { ok: false, errors: asyncErrors }
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
