import { z } from 'zod'
import type {
  ArrayFieldDef, AsyncValidator, ComputedFieldDef, ConditionalRule, CrossFieldRule,
  FieldDef, FieldGroupDef, FieldMeta, FormContext, FormDefinition,
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
    toRedacted:     (data, ctx) => buildRedacted(fields, data, ctx ?? {}),
  }
}

// ── Visibility / required / editable helpers ───────────────────────────────────

export function isVisible<T>(field: FieldDef<T>, ctx: Partial<FormContext<T>>): boolean {
  if (field.visible === undefined || field.visible === true) return true
  if (field.visible === false) return false
  return field.visible(ctx as FormContext<T>)
}

export function isEditable<T>(field: FieldDef<T>, ctx: Partial<FormContext<T>>): boolean {
  if (field.type === 'computed') return false
  if (field.editable === undefined || field.editable === true) return true
  if (field.editable === false) return false
  return field.editable(ctx as FormContext<T>)
}

function resolveRequired<T>(field: FieldDef<T>, ctx: FormContext<T>): boolean {
  if (field.type === 'computed') return false
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
    if (field.type === 'computed') continue
    if (!isVisible(field, ctx)) continue
    if (!isEditable(field, ctx)) continue
    const resolve = makeResolver((field as { messages?: Partial<Record<MessageKey, string>> }).messages, formMessages, translate)
    shape[field.name] = fieldToZod(field, resolveRequired(field, ctx), resolve, formMessages, translate)
  }
  return z.object(shape) as unknown as z.ZodType<T>
}

function fieldToZod<T>(
  field:        FieldDef<T>,
  isRequired:   boolean,
  resolve:      MessageResolver,
  formMessages?: Partial<Record<MessageKey, string>>,
  translate?:    MessageResolver,
): z.ZodTypeAny {
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
    case 'computed':
      return z.never()
    case 'array': {
      const a = field as unknown as ArrayFieldDef<Record<string, unknown>>
      const rowCtx: FormContext<Record<string, unknown>> = { values: {}, validationContext: 'submit' }
      const rowShape: Record<string, z.ZodTypeAny> = {}
      for (const sub of a.fields) {
        const subResolve = makeResolver((sub as { messages?: Partial<Record<MessageKey, string>> }).messages, formMessages, translate)
        rowShape[sub.name as string] = fieldToZod(sub as FieldDef<Record<string, unknown>>, resolveRequired(sub as FieldDef<Record<string, unknown>>, rowCtx), subResolve, formMessages, translate)
      }
      const rowSchema = z.object(rowShape)
      let baseArr = z.array(rowSchema)
      if (a.min !== undefined) baseArr = baseArr.min(a.min, resolve('arrayMin', { min: a.min }))
      if (a.max !== undefined) baseArr = baseArr.max(a.max, resolve('arrayMax', { max: a.max }))
      const hasRules = (a.rowRules?.length ?? 0) > 0 || (a.arrayRules?.length ?? 0) > 0
      const arr: z.ZodTypeAny = hasRules
        ? baseArr.superRefine((rows, zodCtx) => {
            if (a.rowRules) {
              rows.forEach((row, i) => {
                for (const rule of a.rowRules!) {
                  const msg = rule.validate(row)
                  if (msg !== null) {
                    const errField = rule.errorField ?? rule.fields[0] ?? '_root'
                    zodCtx.addIssue({ code: z.ZodIssueCode.custom, path: [i, errField], message: msg })
                  }
                }
              })
            }
            if (a.arrayRules) {
              for (const rule of a.arrayRules!) {
                const msg = rule(rows)
                if (msg !== null) zodCtx.addIssue({ code: z.ZodIssueCode.custom, message: msg })
              }
            }
          })
        : baseArr
      return isRequired ? arr : arr.optional()
    }
    case 'group': {
      const g = field as unknown as FieldGroupDef<Record<string, unknown>>
      const grpCtx: FormContext<Record<string, unknown>> = { values: {}, validationContext: 'submit' }
      const grpShape: Record<string, z.ZodTypeAny> = {}
      for (const sub of g.fields) {
        const subResolve = makeResolver((sub as { messages?: Partial<Record<MessageKey, string>> }).messages, formMessages, translate)
        grpShape[sub.name as string] = fieldToZod(sub as FieldDef<Record<string, unknown>>, resolveRequired(sub as FieldDef<Record<string, unknown>>, grpCtx), subResolve, formMessages, translate)
      }
      const grpSchema = z.object(grpShape)
      const hasRules = (g.rules?.length ?? 0) > 0
      const withRules: z.ZodTypeAny = hasRules
        ? grpSchema.superRefine((data, zodCtx) => {
            for (const rule of g.rules!) {
              const msg = rule.validate(data)
              if (msg !== null) {
                const errField = rule.errorField ?? rule.fields[0] ?? '_root'
                zodCtx.addIssue({ code: z.ZodIssueCode.custom, path: [errField], message: msg })
              }
            }
          })
        : grpSchema
      return isRequired ? withRules : withRules.optional()
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
    .map(field => buildSingleFieldMeta(field, ctx))
}

function buildSingleFieldMeta<T>(field: FieldDef<T>, ctx?: Partial<FormContext<T>>): FieldMeta {
  if (field.type === 'computed') {
    const cf = field as ComputedFieldDef<T>
    return { name: cf.name, label: cf.label, type: 'computed', computed: true, readonly: true }
  }
  const required = typeof field.required === 'function'
    ? (ctx ? field.required(ctx as FormContext<T>) : undefined)
    : field.required
  const editable = typeof field.editable === 'function'
    ? (ctx ? field.editable(ctx as FormContext<T>) : undefined)
    : field.editable
  const meta: FieldMeta = { name: field.name, label: field.label, type: field.type }
  if ('placeholder' in field && field.placeholder)  meta.placeholder    = field.placeholder
  if (required !== undefined)                        meta.required       = required
  if (editable === false)                            meta.readonly       = true
  if ('options' in field && field.options)           meta.options        = field.options
  if ('visibleWhenRule' in field && field.visibleWhenRule)   meta.visible_when  = field.visibleWhenRule as ConditionalRule
  if ('requiredWhenRule' in field && field.requiredWhenRule) meta.required_when = field.requiredWhenRule as ConditionalRule
  if (field.type === 'relation') {
    const r = field as RelationFieldDef<T>
    meta.relation = { ...r.relation, ...(r.multiple ? { multiple: true } : {}) }
  }
  if (field.type === 'array') {
    const a = field as unknown as ArrayFieldDef<T>
    meta.fields = a.fields.map(f => buildSingleFieldMeta(f as unknown as FieldDef<T>, {}))
    if (a.min !== undefined) meta.min = a.min
    if (a.max !== undefined) meta.max = a.max
  }
  if (field.type === 'group') {
    const g = field as unknown as FieldGroupDef<T>
    meta.fields = g.fields.map(f => buildSingleFieldMeta(f as unknown as FieldDef<T>, {}))
  }
  return meta
}

// ── Redaction (sensitive fields) ───────────────────────────────────────────────

function buildRedacted<T>(
  fields: FieldDef<T>[],
  data:   unknown,
  ctx:    Partial<FormContext<T>>,
): Record<string, unknown> {
  const out = { ...(typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}) }
  for (const field of fields) {
    if (field.type === 'computed') {
      if (isVisible(field, ctx)) {
        out[field.name] = (field as ComputedFieldDef<T>).compute(out as Partial<T>)
      }
      continue
    }
    if (!isVisible(field, ctx)) {
      if ((field as { sensitive?: boolean }).sensitive) {
        out[field.name] = null
      } else {
        delete out[field.name]
      }
      continue
    }
    if (field.type === 'group') {
      const g = field as unknown as FieldGroupDef<Record<string, unknown>>
      const nested = out[field.name]
      if (nested && typeof nested === 'object') {
        out[field.name] = buildRedacted(
          g.fields as unknown as FieldDef<T>[],
          nested,
          ctx,
        )
      }
      continue
    }
    if (field.type === 'array') {
      const a = field as unknown as ArrayFieldDef<Record<string, unknown>>
      const rows = out[field.name]
      if (Array.isArray(rows)) {
        out[field.name] = rows.map(row =>
          buildRedacted(a.fields as unknown as FieldDef<T>[], row, ctx)
        )
      }
      continue
    }
  }
  return out
}
