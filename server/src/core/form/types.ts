import { z } from 'zod'

export type FormState = 'idle' | 'created' | 'updated' | 'error'

export type FormResult<T> =
  | { state: 'idle' }
  | { state: 'created'; data: T }
  | { state: 'updated'; data: T }
  | { state: 'error';   errors: Record<string, string[]> }

export interface BuiltForm<TInput> {
  schema: z.ZodType<TInput>
  uniqueChecks: UniqueCheck[]
}

export interface UniqueCheck {
  field: string
  table: string
  column: string
}
