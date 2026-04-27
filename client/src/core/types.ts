export type FieldType = 'text' | 'email' | 'url' | 'number' | 'boolean' | 'select' | 'textarea'

export interface FieldConfig {
  name: string
  label: string
  type: FieldType
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[]
}

export type FormState = 'idle' | 'submitting' | 'created' | 'updated' | 'error'

export interface FormEngineConfig<T> {
  endpoint: string
  fields?: FieldConfig[]                // static override — skips schema fetch
  onSuccess?: (data: T, state: 'created' | 'updated') => void
  onError?: (errors: Record<string, string[]>) => void
}

export type ApiResponse<T> =
  | { ok: true;  data: T }
  | { ok: false; errors: Record<string, string[]> }
