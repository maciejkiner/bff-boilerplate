import { z } from 'zod'
import type {
  AsyncValidator, CrossFieldRule, FieldDef, FieldMeta, FormContext, FormDefinition, FormSchema,
  MessageKey, MessageResolver, RelationFieldDef, StepDef, UniqueCheck,
} from './types.js'
import { makeResolver } from './messages.js'

export interface DefineFormOptions<TInput> {
  rules?:           CrossFieldRule<TInput>[]
  steps?:           StepDef<TInput>[]
  asyncValidators?: AsyncValidator<TInput>[]
  messages?:        Partial<Record<MessageKey, string>>
  translate?:       MessageResolver
}

export function defineForm<TInput>(
  fields: FieldDef<TInput>[],
  options: DefineFormOptions<TInput> = {},
): FormDefinition<TInput> {
  const crossFieldRules  = options.rules ?? []
  const steps            = options.steps ?? []
  const asyncValidators  = options.asyncValidators ?? []
  const formMessages     = options.messages
  const translate        = options.translate
  return {
    fields,
    crossFieldRules,
    steps,
    asyncValidators,
    ...(translate ? { translate } : {}),
    toZodSchema:    (ctx) => buildZodSchema(fields, ctx, formMessages, translate),
    toUniqueChecks: (ctx) => collectUniqueChecks(fields, ctx),
    toFieldMetas:   (ctx) => buildFieldMetas(fields, ctx),
    toSchema:       (ctx) => ({
      fields: buildFieldMetas(fields, ctx),
      ...(steps.length ? { steps: steps.map(s => ({ name: s.name, label: s.label, fields: s.fields })) } : {}),
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

function buildZodSchema<T>(
  fields:      FieldDef<T>[],
  ctx:         FormContext<T>,
  formMessages?: Partial<Record<MessageKey, string>>,
  translate?:    MessageResolver,
): z.ZodType<T> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of fields) {
    if (!isVisible(field, ctx)) continue
    const resolve = makeResolver(field.messages, formMessages, translate)
    shape[field.name] = fieldToZod(field, resolveRequired(field, ctx), resolve)
  }
  return z.object(shape) as unknown as z.ZodType<T>
}

function fieldToZod<T>(field: FieldDef<T>, isRequired: boolean, resolve: MessageResolver): z.ZodTypeAny {
  switch (field.type) {
    case 'text':
    case 'textarea': {
      let s = z.string()
      if ('minLength' in field && field.minLength) s = s.min(field.minLength, resolve('minLength', { min: field.minLength }))
      if ('maxLength' in field && field.maxLength) s = s.max(field.maxLength, resolve('maxLength', { max: field.maxLength }))
      return isRequired ? s.min(1, resolve('required')) : s.optional().or(z.literal('')).optional()
    }
    case 'email': {
      const s = z.string().email(resolve('email'))
      return isRequired ? s.min(1, resolve('required')) : s.optional().or(z.literal('')).optional()
    }
    case 'url': {
      const s = z.string().url(resolve('url'))
      return isRequired ? s.min(1, resolve('required')) : s.optional().or(z.literal('')).optional()
    }
    case 'number': {
      let s = z.coerce.number()
      if ('min' in field && field.min !== undefined) s = s.min(field.min, resolve('minValue', { min: field.min }))
      if ('max' in field && field.max !== undefined) s = s.max(field.max, resolve('maxValue', { max: field.max }))
      return isRequired ? s : s.optional()
    }
    case 'boolean':
      return z.coerce.boolean().optional()
    case 'select': {
      const values = field.options.map(o => o.value) as [string, ...string[]]
      const s = z.enum(values)
      return isRequired ? s : s.optional()
    }
    case 'date': {
      const min = 'min' in field ? field.min : undefined
      const max = 'max' in field ? field.max : undefined
      const base = z.string().date(resolve('date'))
      const withMin = min ? base.refine(v => v >= min, resolve('dateMin', { min })) : base
      const s: z.ZodTypeAny = max ? withMin.refine(v => v <= max, resolve('dateMax', { max })) : withMin
      return isRequired ? s : s.optional()
    }
    case 'richtext': {
      let s = z.string()
      if ('minLength' in field && field.minLength) s = s.min(field.minLength, resolve('minLength', { min: field.minLength }))
      if ('maxLength' in field && field.maxLength) s = s.max(field.maxLength, resolve('maxLength', { max: field.maxLength }))
      return isRequired ? s.min(1, resolve('required')) : s.optional()
    }
    case 'relation': {
      const id = z.number().int().positive()
      return (field as RelationFieldDef<T>).multiple
        ? (isRequired ? z.array(id).min(1, resolve('required')) : z.array(id).optional())
        : (isRequired ? id : id.optional())
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
      if (field.type === 'relation') {
        const r = field as RelationFieldDef<T>
        meta.relation = { ...r.relation, ...(r.multiple ? { multiple: true } : {}) }
      }
      return meta
    })
}
