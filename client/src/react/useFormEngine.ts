import { useRef, useSyncExternalStore } from 'react'
import { FormEngine } from '../core/FormEngine.js'
import type { FieldConfig, FormEngineConfig, FormState } from '../core/types.js'

interface UseFormEngineResult<T extends { id?: number }> {
  engine:     FormEngine<T>
  state:      FormState
  errors:     Record<string, string[]>
  fields:     FieldConfig[]
  values:     Partial<T>
  isSubmitting: boolean
  autosaving:   boolean
  lastSaved:    Date | null
}

export function useFormEngine<T extends { id?: number }>(config: FormEngineConfig<T>): UseFormEngineResult<T>
export function useFormEngine<T extends { id?: number }>(engine: FormEngine<T>): UseFormEngineResult<T>

export function useFormEngine<T extends { id?: number }>(
  configOrEngine: FormEngineConfig<T> | FormEngine<T>,
): UseFormEngineResult<T> {
  const engineRef = useRef<FormEngine<T> | null>(null)
  if (!engineRef.current) {
    engineRef.current = configOrEngine instanceof FormEngine
      ? configOrEngine
      : new FormEngine(configOrEngine)
  }
  const engine = engineRef.current

  const snap = useSyncExternalStore(
    cb => engine.subscribe(cb),
    () => ({
      state:      engine.state,
      errors:     engine.errors,
      fields:     engine.fields,
      values:     engine.values,
      autosaving: engine.autosaving,
      lastSaved:  engine.lastSaved,
    }),
  )

  return {
    engine,
    state:        snap.state,
    errors:       snap.errors,
    fields:       snap.fields,
    values:       snap.values,
    isSubmitting: snap.state === 'submitting',
    autosaving:   snap.autosaving,
    lastSaved:    snap.lastSaved,
  }
}
