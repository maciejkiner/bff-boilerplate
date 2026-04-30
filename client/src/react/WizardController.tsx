import { useState } from 'react'
import { useWizardEngine } from './useWizardEngine.js'
import { FormController } from './FormController.js'
import type { WizardEngine } from '../core/WizardEngine.js'

interface Props<T extends object> {
  engine:       WizardEngine<T & { id?: number }>
  submitLabel?: string
}

export function WizardController<T extends object>({ engine, submitLabel = 'Submit' }: Props<T>) {
  type TT = T & { id?: number }
  const {
    state, errors, currentStepIndex, currentStep, currentStepFields,
    steps, isFirst, isLast, isSaving, isSubmitting,
  } = useWizardEngine<T>(engine.config as any)

  const [values, setValues] = useState<Record<string, unknown>>(
    () => ({ ...(engine.values as Record<string, unknown>) })
  )

  const set = (name: string, value: unknown) =>
    setValues(prev => ({ ...prev, [name]: value }))

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault()
    engine.nextStep(values as Partial<TT>)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    engine.submitFinal(values as Partial<TT>)
  }

  if (state === 'submitted') {
    return <div className="wizard-success">Form submitted successfully.</div>
  }

  if (currentStepFields.length === 0 && state !== 'error') {
    return <div className="form-loading">Loading form…</div>
  }

  const rootError = errors['_root']?.[0]
  const busy = isSaving || isSubmitting

  return (
    <div className="wizard">
      {/* Step indicators */}
      {steps.length > 1 && (
        <ol className="wizard-steps">
          {steps.map((s, i) => (
            <li key={s.name} className={i === currentStepIndex ? 'active' : i < currentStepIndex ? 'done' : ''}>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={isLast ? handleSubmit : handleNext} noValidate>
        {rootError && <div role="alert" className="form-error">{rootError}</div>}

        {/* Render only current step's fields via FormController's field override */}
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
