import { z } from 'zod'

export type FormState = 'idle' | 'created' | 'updated' | 'error'

export type FormResult<T> =
  | { state: 'idle' }
  | { state: 'created'; data: T }
  | { state: 'updated'; data: T }
  | { state: 'error';   errors: Record<string, string[]> }

export type FieldType = 'text' | 'email' | 'url' | 'number' | 'boolean' | 'select' | 'textarea'

export interface FieldMeta {
  name: string
  label: string
  type: FieldType
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[]
}

export interface BuiltForm<TInput> {
  schema: z.ZodType<TInput>
  uniqueChecks: UniqueCheck[]
  toFieldConfigs(): FieldMeta[]
}

export interface UniqueCheck {
  field: string
  table: string
  column: string
}
