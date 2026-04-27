import { useRef, useSyncExternalStore } from 'react'
import { FormEngine } from '../core/FormEngine.js'
import type { FieldConfig, FormEngineConfig, FormState } from '../core/types.js'

interface UseFormEngineResult<T extends { id?: number }> {
  engine: FormEngine<T>
  state: FormState
  errors: Record<string, string[]>
  fields: FieldConfig[]
  isSubmitting: boolean
}

export function useFormEngine<T extends { id?: number }>(
  config: FormEngineConfig<T>
): UseFormEngineResult<T>

// Overload: accept an existing engine instance (used by FormController internally)
export function useFormEngine<T extends { id?: number }>(
  engine: FormEngine<T>
): UseFormEngineResult<T>

export function useFormEngine<T extends { id?: number }>(
  configOrEngine: FormEngineConfig<T> | FormEngine<T>
): UseFormEngineResult<T> {
  const engineRef = useRef<FormEngine<T> | null>(null)
  if (!engineRef.current) {
    engineRef.current = configOrEngine instanceof FormEngine
      ? configOrEngine
      : new FormEngine(configOrEngine)
  }
  const engine = engineRef.current

  const state = useSyncExternalStore(
    cb => engine.subscribe(cb),
    () => engine.state,
  )

  const errors = useSyncExternalStore(
    cb => engine.subscribe(cb),
    () => engine.errors,
  )

  const fields = useSyncExternalStore(
    cb => engine.subscribe(cb),
    () => engine.fields,
  )

  return {
    engine,
    state,
    errors,
    fields,
    isSubmitting: state === 'submitting',
  }
}
