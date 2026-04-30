import { useRef, useSyncExternalStore } from 'react'
import { WizardEngine, type WizardEngineConfig } from '../core/WizardEngine.js'
import type { FieldConfig, StepConfig } from '../core/types.js'
import type { WizardState } from '../core/WizardEngine.js'

interface UseWizardEngineResult<T> {
  engine:           WizardEngine<T & { id?: number }>
  state:            WizardState
  errors:           Record<string, string[]>
  currentStepIndex: number
  currentStep:      StepConfig | undefined
  currentStepFields: FieldConfig[]
  steps:            StepConfig[]
  isFirst:          boolean
  isLast:           boolean
  isSaving:         boolean
  isSubmitting:     boolean
}

export function useWizardEngine<T extends object>(
  config: WizardEngineConfig<T & { id?: number }>,
): UseWizardEngineResult<T & { id?: number }> {
  type TT = T & { id?: number }
  const engineRef = useRef<WizardEngine<TT> | null>(null)
  if (!engineRef.current) engineRef.current = new WizardEngine<TT>(config)
  const engine = engineRef.current

  const snap = useSyncExternalStore(
    cb => engine.subscribe(cb),
    () => ({
      state:            engine.state,
      errors:           engine.errors,
      currentStepIndex: engine.currentStepIndex,
      steps:            engine.steps,
      fields:           engine.fields,
    }),
  )

  const step = snap.steps[snap.currentStepIndex]

  return {
    engine,
    state:             snap.state,
    errors:            snap.errors,
    currentStepIndex:  snap.currentStepIndex,
    currentStep:       step,
    currentStepFields: step
      ? snap.fields.filter(f => step.fields.includes(f.name))
      : snap.fields,
    steps:             snap.steps,
    isFirst:           snap.currentStepIndex === 0,
    isLast:            snap.currentStepIndex === snap.steps.length - 1,
    isSaving:          snap.state === 'saving',
    isSubmitting:      snap.state === 'submitting',
  }
}
