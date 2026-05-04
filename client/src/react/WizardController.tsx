import { useSyncExternalStore } from 'react'
import { FormController } from './FormController.js'
import type { WizardEngine } from '../core/WizardEngine.js'

interface Props<T extends object> {
  engine:       WizardEngine<T & { id?: number }>
  submitLabel?: string
}

export function WizardController<T extends object>({ engine, submitLabel = 'Submit' }: Props<T>) {
  type TT = T & { id?: number }

  // Subscribe directly to the passed engine — no second engine created
  const snap = useSyncExternalStore(
    cb => engine.subscribe(cb),
    () => ({
      state:            engine.state,
      errors:           engine.errors,
      currentStepIndex: engine.currentStepIndex,
      steps:            engine.steps,
      fields:           engine.fields,
      values:           engine.values,
    }),
  )

  const step              = snap.steps[snap.currentStepIndex]
  const currentStepFields = step
    ? snap.fields.filter(f => step.fields.includes(f.name))
    : snap.fields
  const isFirst      = snap.currentStepIndex === 0
  const isLast       = snap.currentStepIndex === snap.steps.length - 1
  const isSaving     = snap.state === 'saving'
  const isSubmitting = snap.state === 'submitting'

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault()
    engine.nextStep(engine.values as Partial<TT>)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    engine.submitFinal(engine.values as Partial<TT>)
  }

  if (snap.state === 'submitted') {
    return <div className="wizard-success">Form submitted successfully.</div>
  }

  // Show loading only while schema is being fetched (steps not yet loaded)
  // An intentionally empty step (e.g. a review/summary step with fields:[])
  // must NOT be treated as loading — check steps.length, not currentStepFields.length
  if (snap.steps.length === 0 && snap.state !== 'error') {
    return <div className="form-loading">Loading form…</div>
  }

  const rootError = snap.errors['_root']?.[0]
  const busy = isSaving || isSubmitting

  return (
    <div className="wizard">
      {/* Step indicators */}
      {snap.steps.length > 1 && (
        <ol className="wizard-steps">
          {snap.steps.map((s, i) => (
            <li key={s.name} className={i === snap.currentStepIndex ? 'active' : i < snap.currentStepIndex ? 'done' : ''}>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={isLast ? handleSubmit : handleNext} noValidate>
        {rootError && <div role="alert" className="form-error">{rootError}</div>}

        <FormController
          engine={engine as any}
          fields={currentStepFields}
          submitLabel={isLast ? submitLabel : 'Next →'}
        />

        {!isFirst && (
          <button type="button" onClick={() => engine.prevStep()} disabled={busy}>
            ← Back
          </button>
        )}
      </form>
    </div>
  )
}
