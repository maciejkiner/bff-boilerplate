import type {
  TextFieldDef, EmailFieldDef, UrlFieldDef, TextareaFieldDef,
  NumberFieldDef, BooleanFieldDef, SelectFieldDef,
  DateFieldDef, RichtextFieldDef, RelationFieldDef, ArrayFieldDef, FieldGroupDef, RowDef,
  ComputedFieldDef, ConditionalOp, ConditionalRule, FormContext,
} from './types.js'

type Def<_T, D> = Omit<D, 'name' | 'type'>

export const text     = <T>(name: keyof T & string, opts: Def<T, TextFieldDef<T>>):     TextFieldDef<T>     => ({ name, type: 'text',     ...opts })
export const email    = <T>(name: keyof T & string, opts: Def<T, EmailFieldDef<T>>):    EmailFieldDef<T>    => ({ name, type: 'email',    ...opts })
export const url      = <T>(name: keyof T & string, opts: Def<T, UrlFieldDef<T>>):      UrlFieldDef<T>      => ({ name, type: 'url',      ...opts })
export const textarea = <T>(name: keyof T & string, opts: Def<T, TextareaFieldDef<T>>): TextareaFieldDef<T> => ({ name, type: 'textarea', ...opts })
export const number   = <T>(name: keyof T & string, opts: Def<T, NumberFieldDef<T>>):   NumberFieldDef<T>   => ({ name, type: 'number',   ...opts })
export const boolean  = <T>(name: keyof T & string, opts: Def<T, BooleanFieldDef<T>>):  BooleanFieldDef<T>  => ({ name, type: 'boolean',  ...opts })
export const select   = <T>(name: keyof T & string, opts: Def<T, SelectFieldDef<T>>):   SelectFieldDef<T>   => ({ name, type: 'select',   ...opts })
export const date     = <T>(name: keyof T & string, opts: Def<T, DateFieldDef<T>>):     DateFieldDef<T>     => ({ name, type: 'date',     ...opts })
export const richtext = <T>(name: keyof T & string, opts: Def<T, RichtextFieldDef<T>>): RichtextFieldDef<T> => ({ name, type: 'richtext', ...opts })
export const relation = <T>(name: keyof T & string, opts: Def<T, RelationFieldDef<T>>): RelationFieldDef<T> => ({ name, type: 'relation', ...opts })
export const array    = <T>(name: keyof T & string, opts: Def<T, ArrayFieldDef<T>> & { fields: RowDef[] }): ArrayFieldDef<T> => ({ name, type: 'array', ...opts })
export const computed = <T>(name: keyof T & string, label: string, compute: (values: Partial<T>) => unknown): ComputedFieldDef<T> => ({ name, type: 'computed', label, compute })
export const group    = <T>(name: keyof T & string, opts: Omit<FieldGroupDef<T>, 'name' | 'type'>): FieldGroupDef<T> => ({ name, type: 'group', ...opts })

// ── Conditional rule helpers ───────────────────────────────────────────────────

function evalConditional<T>(rule: ConditionalRule, ctx: FormContext<T>): boolean {
  const v = (ctx.values as Record<string, unknown>)[rule.field]
  switch (rule.op) {
    case 'eq':    return v === rule.value
    case 'neq':   return v !== rule.value
    case 'in':    return Array.isArray(rule.value) && rule.value.includes(v)
    case 'notIn': return Array.isArray(rule.value) && !rule.value.includes(v)
  }
}

export function visibleWhen<T>(
  field: keyof T & string,
  op:    ConditionalOp,
  value: unknown,
): { visible: (ctx: FormContext<T>) => boolean; visibleWhenRule: ConditionalRule } {
  const rule: ConditionalRule = { field, op, value }
  return { visible: (ctx) => evalConditional(rule, ctx), visibleWhenRule: rule }
}

export function requiredWhen<T>(
  field: keyof T & string,
  op:    ConditionalOp,
  value: unknown,
): { required: (ctx: FormContext<T>) => boolean; requiredWhenRule: ConditionalRule } {
  const rule: ConditionalRule = { field, op, value }
  return { required: (ctx) => evalConditional(rule, ctx), requiredWhenRule: rule }
}
