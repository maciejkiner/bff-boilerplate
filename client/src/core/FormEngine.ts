import type { ApiResponse, FormEngineConfig, FormState } from './types.js'

export class FormEngine<T extends { id?: number }> {
  state: FormState = 'idle'
  errors: Record<string, string[]> = {}
  values: Partial<T> = {}

  private readonly config: FormEngineConfig<T>
  private listeners = new Set<() => void>()

  constructor(config: FormEngineConfig<T>) {
    this.config = config
    if (config) {
      // initialValues support via load()
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

  reset(): void {
    this.state = 'idle'
    this.errors = {}
    this.values = {}
    this.notify()
  }

  async submit(formValues: T): Promise<void> {
    if (this.state === 'submitting') return

    this.state = 'submitting'
    this.errors = {}
    this.notify()

    const id = (formValues as Record<string, unknown>)['id'] as number | undefined
    const endpoint = id ? `${this.config.endpoint}/${id}` : this.config.endpoint
    const method   = id ? 'PUT' : 'POST'

    try {
      const res = await fetch(endpoint, {
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
}
