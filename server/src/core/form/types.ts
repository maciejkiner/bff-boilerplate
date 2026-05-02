import { z } from 'zod'
import type { MessageKey, MessageResolver } from './messages.js'
export type { MessageKey, MessageParams, MessageResolver } from './messages.js'

export type FormState = 'idle' | 'created' | 'updated' | 'error'

export type FormResult<T> =
  | { state: 'idle' }
  | { state: 'created'; data: T }
  | { state: 'updated'; data: T }
  | { state: 'error';   errors: Record<string, string[]> }

// ── Validation context ─────────────────────────────────────────────────────────

export type ValidationContext = 'draft' | 'submit' | 'approve' | 'custom'

// ── Form context ───────────────────────────────────────────────────────────────

export interface FormContext<TValues = Record<string, unknown>> {
  values:            Partial<TValues>
  user?:             { id: number; role: string; [key: string]: unknown }
  validationContext: ValidationContext
}

// ── Field types ────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'email' | 'url' | 'number' | 'boolean' | 'select' | 'textarea' | 'date' | 'richtext' | 'relation' | 'array' | 'computed' | 'group'

export type RowDef = FieldDef<Record<string, unknown>>

// ── Conditional rules (declarative visibility / required) ──────────────────────

export type ConditionalOp = 'eq' | 'neq' | 'in' | 'notIn'

export interface ConditionalRule {
  field: string
  op:    ConditionalOp
  value: unknown
}

interface BaseFieldDef<TValues> {
  name:               keyof TValues & string
  label:              string
  placeholder?:       string
  required?:          boolean | ((ctx: FormContext<TValues>) => boolean)
  visible?:           boolean | ((ctx: FormContext<TValues>) => boolean)
  editable?:          boolean | ((ctx: FormContext<TValues>) => boolean)
  sensitive?:         boolean
  filterable?:        boolean
  sortable?:          boolean
  defaultValue?:      unknown | ((ctx: FormContext<TValues>) => unknown)
  messages?:          Partial<Record<MessageKey, string>>
  validators?:        string[]
  visibleWhenRule?:   ConditionalRule
  requiredWhenRule?:  ConditionalRule
}

export interface TextFieldDef<T>     extends BaseFieldDef<T> { type: 'text';     minLength?: number; maxLength?: number; unique?: UniqueCheck }
export interface EmailFieldDef<T>    extends BaseFieldDef<T> { type: 'email';    unique?: UniqueCheck }
export interface UrlFieldDef<T>      extends BaseFieldDef<T> { type: 'url' }
export interface TextareaFieldDef<T> extends BaseFieldDef<T> { type: 'textarea'; minLength?: number; maxLength?: number }
export interface NumberFieldDef<T>   extends BaseFieldDef<T> { type: 'number';   min?: number; max?: number }
export interface BooleanFieldDef<T>  extends BaseFieldDef<T> { type: 'boolean' }
export interface SelectFieldDef<T>   extends BaseFieldDef<T> { type: 'select';   options: { value: string; label: string }[] }
export interface DateFieldDef<T>     extends BaseFieldDef<T> { type: 'date';     min?: string; max?: string }
export interface RichtextFieldDef<T> extends BaseFieldDef<T> { type: 'richtext'; minLength?: number; maxLength?: number }

// ── Computed field ─────────────────────────────────────────────────────────────

export interface ComputedFieldDef<T> {
  type:     'computed'
  name:     keyof T & string
  label:    string
  compute:  (values: Partial<T>) => unknown
  visible?: boolean | ((ctx: FormContext<T>) => boolean)
}

// ── Array field ────────────────────────────────────────────────────────────────

export interface ArrayCrossFieldRule {
  fields:      string[]
  validate:    (row: Record<string, unknown>) => string | null
  errorField?: string
}

export type ArrayValidateRule = (rows: Record<string, unknown>[]) => string | null

export interface ArrayFieldDef<T> extends BaseFieldDef<T> {
  type:         'array'
  fields:       RowDef[]
  min?:         number
  max?:         number
  rowRules?:    ArrayCrossFieldRule[]
  arrayRules?:  ArrayValidateRule[]
}

// ── Group field ────────────────────────────────────────────────────────────────

export interface GroupCrossFieldRule {
  fields:      string[]
  validate:    (group: Record<string, unknown>) => string | null
  errorField?: string
}

export interface FieldGroupDef<T> extends BaseFieldDef<T> {
  type:   'group'
  fields: RowDef[]
  rules?: GroupCrossFieldRule[]
}

// ── Relation field ─────────────────────────────────────────────────────────────

export interface RelationConfig {
  endpoint:   string
  labelField: string
  valueField: string
}

export interface RelationFieldDef<T> extends BaseFieldDef<T> {
  type:      'relation'
  relation:  RelationConfig
  multiple?: boolean
}

export type FieldDef<T> =
  | TextFieldDef<T>
  | EmailFieldDef<T>
  | UrlFieldDef<T>
  | TextareaFieldDef<T>
  | NumberFieldDef<T>
  | BooleanFieldDef<T>
  | SelectFieldDef<T>
  | DateFieldDef<T>
  | RichtextFieldDef<T>
  | RelationFieldDef<T>
  | ArrayFieldDef<T>
  | FieldGroupDef<T>
  | ComputedFieldDef<T>

// ── Async validators ───────────────────────────────────────────────────────────

export interface AsyncValidator<TInput> {
  field:    keyof TInput & string | '_root'
  validate: (value: unknown, ctx: FormContext<TInput>) => Promise<string | null>
}

// ── Cross-field validation ─────────────────────────────────────────────────────

export interface CrossFieldRule<TInput> {
  fields:   (keyof TInput & string)[]
  validate: (values: Partial<TInput>, ctx: FormContext<TInput>) => string | null
  /** Field to attach the error to. Defaults to fields[0]. '_root' for form-level. */
  errorField?: keyof TInput & string | '_root'
}

// ── Steps ──────────────────────────────────────────────────────────────────────

export interface StepDef<TInput> {
  name:   string
  label:  string
  fields: (keyof TInput & string)[]
}

// ── FormDefinition ─────────────────────────────────────────────────────────────

export interface FieldMeta {
  name:           string
  label:          string
  type:           FieldType
  placeholder?:   string
  required?:      boolean
  readonly?:      boolean
  computed?:      boolean
  options?:       { value: string; label: string }[]
  relation?:      RelationConfig & { multiple?: boolean }
  fields?:        FieldMeta[]
  min?:           number
  max?:           number
  visible_when?:  ConditionalRule
  required_when?: ConditionalRule
}

export interface StepMeta {
  name:   string
  label:  string
  fields: string[]
}

export interface FormSchema {
  fields: FieldMeta[]
  steps?: StepMeta[]
}

export interface FormDefinition<TInput> {
  fields:           FieldDef<TInput>[]
  steps:            StepDef<TInput>[]
  crossFieldRules:  CrossFieldRule<TInput>[]
  asyncValidators:  AsyncValidator<TInput>[]
  translate?:       MessageResolver
  toZodSchema(ctx: FormContext<TInput>): z.ZodType<TInput>
  toUniqueChecks(ctx: FormContext<TInput>): UniqueCheck[]
  toFieldMetas(ctx?: Partial<FormContext<TInput>>): FieldMeta[]
  toSchema(ctx?: Partial<FormContext<TInput>>): FormSchema
  toRedacted(data: unknown, ctx?: Partial<FormContext<TInput>>): Record<string, unknown>
}

export interface UniqueCheck {
  field:  string
  table:  string
  column: string
}
