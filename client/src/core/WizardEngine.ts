import type { ApiResponse, FieldConfig, FormSchema, StepConfig } from './types.js'

export type WizardState = 'idle' | 'loading' | 'saving' | 'submitting' | 'submitted' | 'error'

export interface WizardEngineConfig<T> {
  endpoint: string
  steps?:   StepConfig[]          // static override — skips schema fetch
  onSubmit?: (data: T) => void
  onError?:  (errors: Record<string, string[]>) => void
}

export class WizardEngine<T extends { id?: number } = Record<string, unknown> & { id?: number }> {
  state:            WizardState = 'idle'
  errors:           Record<string, string[]> = {}
  values:           Partial<T> = {}
  fields:           FieldConfig[] = []
  steps:            StepConfig[] = []
  currentStepIndex: number = 0
  submissionId:     number | null = null

  private readonly config: WizardEngineConfig<T>
  private listeners = new Set<() => void>()

  constructor(config: WizardEngineConfig<T>) {
    this.config = config
    if (config.steps) {
      this.steps = config.steps
    } else {
      this.fetchSchema()
    }
  }

  // ── Computed ─────────────────────────────────────────────────────────────────

  get currentStep(): StepConfig | undefined {
    return this.steps[this.currentStepIndex]
  }

  get currentStepFields(): FieldConfig[] {
    const step = this.currentStep
    if (!step) return this.fields
    return this.fields.filter(f => step.fields.includes(f.name))
  }

  get isFirst(): boolean { return this.currentStepIndex === 0 }
  get isLast():  boolean { return this.currentStepIndex === this.steps.length - 1 }

  // ── Subscriptions ─────────────────────────────────────────────────────────────

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    this.listeners.forEach(fn => fn())
  }

  // ── Navigation ────────────────────────────────────────────────────────────────

  /** Save current step and advance. Creates the draft on first call. */
  async nextStep(stepValues: Partial<T>): Promise<void> {
    if (this.state === 'saving') return
    const step = this.currentStep
    if (!step) return

    this.state  = 'saving'
    this.errors = {}
    this.values = { ...this.values, ...stepValues }
    this.notify()

    try {
      let saved: T & { id: number }

      if (this.submissionId === null) {
        // First step — create the draft
        const res  = await fetch(this.config.endpoint, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ data: this.values }),
        })
        const json = await res.json() as ApiResponse<T & { id: number }>
        if (!json.ok) { this.setError(json.errors); return }
        saved = json.data
        this.submissionId = saved.id
      } else {
        // Subsequent steps — patch the step
        const res  = await fetch(`${this.config.endpoint}/${this.submissionId}/steps/${step.name}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ data: this.values }),
        })
        const json = await res.json() as ApiResponse<T & { id: number }>
        if (!json.ok) { this.setError(json.errors); return }
        saved = json.data
      }

      this.values = { ...this.values, ...((saved as any).data ?? {}) }
      this.state  = 'idle'
      this.currentStepIndex++
      this.notify()
    } catch {
      this.setError({ _root: ['Network error — please try again'] })
    }
  }

  prevStep(): void {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--
      this.errors = {}
      this.notify()
    }
  }

  /** Save last step and submit the whole form. */
  async submitFinal(stepValues: Partial<T>): Promise<void> {
    if (this.state === 'submitting' || !this.submissionId) return

    this.state  = 'submitting'
    this.errors = {}
    this.values = { ...this.values, ...stepValues }
    this.notify()

    try {
      // Save last step first
      const step = this.currentStep
      if (step) {
        const patchRes  = await fetch(`${this.config.endpoint}/${this.submissionId}/steps/${step.name}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ data: this.values }),
        })
        const patchJson = await patchRes.json() as ApiResponse<unknown>
        if (!patchJson.ok) { this.setError((patchJson as any).errors); return }
      }

      // Submit
      const res  = await fetch(`${this.config.endpoint}/${this.submissionId}/submit`, {
        method: 'POST',
      })
      const json = await res.json() as ApiResponse<T>
      if (!json.ok) { this.setError(json.errors); return }

      this.state = 'submitted'
      this.notify()
      this.config.onSubmit?.(json.data)
    } catch {
      this.setError({ _root: ['Network error — please try again'] })
    }
  }

  load(submission: { id: number; data: Partial<T>; current_step?: string | null }): void {
    this.submissionId     = submission.id
    this.values           = { ...submission.data }
    const stepIdx         = this.steps.findIndex(s => s.name === submission.current_step)
    this.currentStepIndex = stepIdx >= 0 ? stepIdx : 0
    this.notify()
  }

  reset(): void {
    this.state            = 'idle'
    this.errors           = {}
    this.values           = {}
    this.currentStepIndex = 0
    this.submissionId     = null
    this.notify()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private setError(errors: Record<string, string[]>): void {
    this.state  = 'error'
    this.errors = errors
    this.notify()
    this.config.onError?.(errors)
  }

  private async fetchSchema(): Promise<void> {
    try {
      const res  = await fetch(`${this.config.endpoint}/schema`)
      const json = await res.json() as ApiResponse<FormSchema>
      if (json.ok) {
        this.fields = json.data.fields
        this.steps  = json.data.steps ?? []
        this.notify()
      }
    } catch {
      this.errors = { _root: ['Failed to load form schema'] }
      this.state  = 'error'
      this.notify()
    }
  }
}
