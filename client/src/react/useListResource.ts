import { useRef, useSyncExternalStore } from 'react'
import { ListEngine } from '../core/ListEngine.js'
import type { ColumnDef, FilterState, ListEngineConfig, ListMeta, SortState } from '../core/types.js'

export interface UseListResourceResult<T extends Record<string, unknown>> {
  engine:    ListEngine<T>
  rows:      T[]
  columns:   ColumnDef[]
  meta:      ListMeta
  sort:      SortState[]
  filters:   FilterState[]
  isLoading: boolean
  error:     string | null
}

export function useListResource<T extends Record<string, unknown>>(
  config: ListEngineConfig,
): UseListResourceResult<T> {
  const engineRef = useRef<ListEngine<T> | null>(null)
  if (!engineRef.current) engineRef.current = new ListEngine<T>(config)
  const engine = engineRef.current

  const snap = useSyncExternalStore(
    cb  => engine.subscribe(cb),
    ()  => ({
      state:   engine.state,
      rows:    engine.rows,
      columns: engine.columns,
      meta:    engine.meta,
      sort:    engine.sort,
      filters: engine.filters,
      error:   engine.error,
    }),
  )

  return {
    engine,
    rows:      snap.rows as T[],
    columns:   snap.columns,
    meta:      snap.meta,
    sort:      snap.sort,
    filters:   snap.filters,
    isLoading: snap.state === 'loading',
    error:     snap.error,
  }
}
