import { useRef, useSyncExternalStore } from 'react'
import { FormEngine } from '../core/FormEngine.js'
import type { FormEngineConfig, FormState } from '../core/types.js'

interface UseFormEngineResult<T extends { id?: number }> {
  engine: FormEngine<T>
  state: FormState
  errors: Record<string, string[]>
  isSubmitting: boolean
}

export function useFormEngine<T extends { id?: number }>(
  config: FormEngineConfig<T>
): UseFormEngineResult<T> {
  // Stable engine instance across renders
  const engineRef = useRef<FormEngine<T> | null>(null)
  if (!engineRef.current) engineRef.current = new FormEngine(config)
  const engine = engineRef.current

  // useSyncExternalStore wires engine notifications directly into React's render cycle
  const state = useSyncExternalStore(
    cb => engine.subscribe(cb),
    () => engine.state,
  )

  const errors = useSyncExternalStore(
    cb => engine.subscribe(cb),
    () => engine.errors,
  )

  return {
    engine,
    state,
    errors,
    isSubmitting: state === 'submitting',
  }
}
