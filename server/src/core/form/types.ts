import { z } from 'zod'

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

export type FieldType = 'text' | 'email' | 'url' | 'number' | 'boolean' | 'select' | 'textarea'

interface BaseFieldDef<TValues> {
  name:          keyof TValues & string
  label:         string
  placeholder?:  string
  required?:     boolean | ((ctx: FormContext<TValues>) => boolean)
  visible?:      boolean | ((ctx: FormContext<TValues>) => boolean)
  defaultValue?: unknown
}

export interface TextFieldDef<T>     extends BaseFieldDef<T> { type: 'text';     minLength?: number; maxLength?: number; unique?: UniqueCheck }
export interface EmailFieldDef<T>    extends BaseFieldDef<T> { type: 'email';    unique?: UniqueCheck }
export interface UrlFieldDef<T>      extends BaseFieldDef<T> { type: 'url' }
export interface TextareaFieldDef<T> extends BaseFieldDef<T> { type: 'textarea'; minLength?: number; maxLength?: number }
export interface NumberFieldDef<T>   extends BaseFieldDef<T> { type: 'number';   min?: number; max?: number }
export interface BooleanFieldDef<T>  extends BaseFieldDef<T> { type: 'boolean' }
export interface SelectFieldDef<T>   extends BaseFieldDef<T> { type: 'select';   options: { value: string; label: string }[] }

export type FieldDef<T> =
  | TextFieldDef<T>
  | EmailFieldDef<T>
  | UrlFieldDef<T>
  | TextareaFieldDef<T>
  | NumberFieldDef<T>
  | BooleanFieldDef<T>
  | SelectFieldDef<T>

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
  name:         string
  label:        string
  type:         FieldType
  placeholder?: string
  required?:    boolean
  options?:     { value: string; label: string }[]
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
  toZodSchema(ctx: FormContext<TInput>): z.ZodType<TInput>
  toUniqueChecks(ctx: FormContext<TInput>): UniqueCheck[]
  toFieldMetas(ctx?: Partial<FormContext<TInput>>): FieldMeta[]
  toSchema(ctx?: Partial<FormContext<TInput>>): FormSchema
}

export interface UniqueCheck {
  field:  string
  table:  string
  column: string
}
