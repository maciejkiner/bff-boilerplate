import { z } from 'zod'
import type {
  CrossFieldRule, FieldDef, FieldMeta, FormContext, FormDefinition, FormSchema,
  StepDef, UniqueCheck,
} from './types.js'

export interface DefineFormOptions<TInput> {
  rules?: CrossFieldRule<TInput>[]
  steps?: StepDef<TInput>[]
}

export function defineForm<TInput>(
  fields: FieldDef<TInput>[],
  options: DefineFormOptions<TInput> = {},
): FormDefinition<TInput> {
  const crossFieldRules = options.rules ?? []
  const steps           = options.steps ?? []
  return {
    fields,
    crossFieldRules,
    steps,
    toZodSchema:    (ctx) => buildZodSchema(fields, ctx),
    toUniqueChecks: (ctx) => collectUniqueChecks(fields, ctx),
    toFieldMetas:   (ctx) => buildFieldMetas(fields, ctx),
    toSchema:       (ctx) => ({
      fields: buildFieldMetas(fields, ctx),
      steps:  steps.length ? steps.map(s => ({ name: s.name, label: s.label, fields: s.fields })) : undefined,
    }),
  }
}

// ── Visibility / required helpers ──────────────────────────────────────────────

export function isVisible<T>(field: FieldDef<T>, ctx: Partial<FormContext<T>>): boolean {
  if (field.visible === undefined || field.visible === true) return true
  if (field.visible === false) return false
  return field.visible(ctx as FormContext<T>)
}

function resolveRequired<T>(field: FieldDef<T>, ctx: FormContext<T>): boolean {
  if (typeof field.required === 'function') return field.required(ctx)
  return field.required === true
}

// ── Zod derivation ─────────────────────────────────────────────────────────────

function buildZodSchema<T>(fields: FieldDef<T>[], ctx: FormContext<T>): z.ZodType<T> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of fields) {
    if (!isVisible(field, ctx)) continue
    shape[field.name] = fieldToZod(field, resolveRequired(field, ctx))
  }
  return z.object(shape) as unknown as z.ZodType<T>
}

function fieldToZod(field: FieldDef<unknown>, isRequired: boolean): z.ZodTypeAny {
  switch (field.type) {
    case 'text':
    case 'textarea': {
      let s = z.string()
      if ('minLength' in field && field.minLength) s = s.min(field.minLength, `Min ${field.minLength} characters`)
      if ('maxLength' in field && field.maxLength) s = s.max(field.maxLength, `Max ${field.maxLength} characters`)
      return isRequired ? s.min(1, 'Required') : s.optional().or(z.literal('')).optional()
    }
    case 'email': {
      const s = z.string().email('Invalid email')
      return isRequired ? s.min(1, 'Required') : s.optional().or(z.literal('')).optional()
    }
    case 'url': {
      const s = z.string().url('Invalid URL')
      return isRequired ? s.min(1, 'Required') : s.optional().or(z.literal('')).optional()
    }
    case 'number': {
      let s = z.coerce.number()
      if ('min' in field && field.min !== undefined) s = s.min(field.min, `Min value is ${field.min}`)
      if ('max' in field && field.max !== undefined) s = s.max(field.max, `Max value is ${field.max}`)
      return isRequired ? s : s.optional()
    }
    case 'boolean':
      return z.coerce.boolean().optional()
    case 'select': {
      const values = field.options.map(o => o.value) as [string, ...string[]]
      const s = z.enum(values)
      return isRequired ? s : s.optional()
    }
  }
}

// ── Unique checks ──────────────────────────────────────────────────────────────

function collectUniqueChecks<T>(fields: FieldDef<T>[], ctx: FormContext<T>): UniqueCheck[] {
  const checks: UniqueCheck[] = []
  for (const field of fields) {
    if (!isVisible(field, ctx)) continue
    if ('unique' in field && field.unique) checks.push(field.unique)
  }
  return checks
}

// ── Field metas (schema endpoint) ─────────────────────────────────────────────

function buildFieldMetas<T>(
  fields: FieldDef<T>[],
  ctx?: Partial<FormContext<T>>,
): FieldMeta[] {
  return fields
    .filter(field => isVisible(field, ctx ?? {}))
    .map(field => {
      const required = typeof field.required === 'function'
        ? (ctx ? field.required(ctx as FormContext<T>) : undefined)
        : field.required
      const meta: FieldMeta = { name: field.name, label: field.label, type: field.type }
      if (field.placeholder)                   meta.placeholder = field.placeholder
      if (required !== undefined)              meta.required    = required
      if ('options' in field && field.options) meta.options     = field.options
      return meta
    })
}
