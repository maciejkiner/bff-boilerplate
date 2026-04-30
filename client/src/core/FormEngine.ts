import type { ApiResponse, FieldConfig, FormEngineConfig, FormSchema, FormState } from './types.js'

export class FormEngine<T extends { id?: number }> {
  state:      FormState = 'idle'
  errors:     Record<string, string[]> = {}
  values:     Partial<T> = {}
  fields:     FieldConfig[] = []
  lastSaved:  Date | null = null
  autosaving: boolean = false

  private readonly config: FormEngineConfig<T>
  private listeners   = new Set<() => void>()
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: FormEngineConfig<T>) {
    this.config = config
    if (config.fields) {
      this.fields = config.fields
    } else {
      this.fetchSchema()
    }
  }

  private async fetchSchema(): Promise<void> {
    try {
      const res  = await fetch(`${this.config.endpoint}/schema`)
      const json = await res.json() as ApiResponse<FormSchema>
      if (json.ok) {
        this.fields = json.data.fields
        this.notify()
      }
    } catch {
      this.errors = { _root: ['Failed to load form schema'] }
      this.state  = 'error'
      this.notify()
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    this.listeners.forEach(fn => fn())
  }

  load(values: Partial<T>): void {
    this.values = { ...values }
    this.notify()
  }

  /** Merge partial values and schedule an autosave if configured. */
  setValues(partial: Partial<T>): void {
    this.values = { ...this.values, ...partial }
    this.notify()
    if (this.config.autosave) this.scheduleAutosave()
  }

  reset(): void {
    this.cancelAutosave()
    this.state     = 'idle'
    this.errors    = {}
    this.values    = {}
    this.lastSaved = null
    this.notify()
  }

  async submit(formValues: T): Promise<void> {
    if (this.state === 'submitting') return
    this.cancelAutosave()

    this.state  = 'submitting'
    this.errors = {}
    this.notify()

    const id       = (formValues as Record<string, unknown>)['id'] as number | undefined
    const endpoint = id ? `${this.config.endpoint}/${id}` : this.config.endpoint
    const method   = id ? 'PUT' : 'POST'

    try {
      const res  = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues),
      })
      const json = await res.json() as ApiResponse<T>

      if (json.ok) {
        this.state  = id ? 'updated' : 'created'
        this.values = json.data
        this.notify()
        this.config.onSuccess?.(json.data, this.state as 'created' | 'updated')
      } else {
        this.state  = 'error'
        this.errors = json.errors
        this.notify()
        this.config.onError?.(json.errors)
      }
    } catch {
      this.state  = 'error'
      this.errors = { _root: ['Network error — please try again'] }
      this.notify()
    }
  }

  // ── Autosave ────────────────────────────────────────────────────────────────

  private scheduleAutosave(): void {
    this.cancelAutosave()
    const delay = this.config.autosave?.delay ?? 2000
    this.autosaveTimer = setTimeout(() => this.performAutosave(), delay)
  }

  private cancelAutosave(): void {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer)
      this.autosaveTimer = null
    }
  }

  private async performAutosave(): Promise<void> {
    const id = (this.values as Record<string, unknown>)['id'] as number | undefined
    if (!id || this.state === 'submitting') return

    this.autosaving = true
    this.notify()

    try {
      const res = await fetch(`${this.config.endpoint}/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(this.values),
      })
      const json = await res.json() as ApiResponse<T>
      if (json.ok) {
        this.lastSaved = new Date()
        this.values    = { ...this.values, ...(json.data as object) }
      }
    } catch {
      // autosave failures are silent — user will be informed on explicit submit
    } finally {
      this.autosaving = false
      this.notify()
    }
  }
}
