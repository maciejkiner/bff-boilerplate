export type FieldType =
  | 'text' | 'email' | 'url' | 'number' | 'boolean' | 'select' | 'textarea'
  | 'date' | 'richtext' | 'relation' | 'computed' | 'array' | 'group'

// ── List / DataTable types ─────────────────────────────────────────────────────

export interface ColumnDef {
  key:       string
  label:     string
  sortable?: boolean                                                // default: true
  render?:   (value: unknown, row: Record<string, unknown>) => unknown
}

export interface SortState {
  field: string
  dir:   'asc' | 'desc'
}

export interface FilterState {
  field: string
  op:    string
  value: string
}

export interface ListMeta {
  total:    number
  page:     number
  pageSize: number
  hasNext:  boolean
}

export type ListEngineState = 'loading' | 'loaded' | 'error'

export interface ListEngineConfig {
  endpoint:     string
  columns?:     ColumnDef[]   // static override — skips schema fetch for column labels
  pageSize?:    number        // default: 20
  defaultSort?: SortState[]
}

export interface FieldConfig {
  name:         string
  label:        string
  type:         FieldType
  placeholder?: string
  required?:    boolean
  options?:     { value: string; label: string }[]
}

export interface StepConfig {
  name:   string
  label:  string
  fields: string[]
}

export interface FormSchema {
  fields: FieldConfig[]
  steps?: StepConfig[]
}

export type FormState = 'idle' | 'submitting' | 'created' | 'updated' | 'error'

export interface AutosaveConfig {
  /** Debounce delay in ms. Default: 2000 */
  delay?: number
}

export interface FormEngineConfig<T> {
  endpoint: string
  fields?:    FieldConfig[]          // static override — skips schema fetch
  autosave?:  AutosaveConfig
  onSuccess?: (data: T, state: 'created' | 'updated') => void
  onError?:   (errors: Record<string, string[]>) => void
}

export type ApiResponse<T> =
  | { ok: true;  data: T }
  | { ok: false; errors: Record<string, string[]> }
