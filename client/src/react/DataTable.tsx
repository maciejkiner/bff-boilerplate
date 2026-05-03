import { useSyncExternalStore } from 'react'
import type { ListEngine } from '../core/ListEngine.js'

interface DataTableProps<T extends Record<string, unknown>> {
  engine:         ListEngine<T>
  onEdit?:        (row: T) => void
  onDelete?:      (row: T) => void
  /** Provide to fully replace the default edit/delete buttons per row. */
  renderActions?: (row: T) => React.ReactNode
}

export function DataTable<T extends Record<string, unknown>>({
  engine,
  onEdit,
  onDelete,
  renderActions,
}: DataTableProps<T>) {
  const snap = useSyncExternalStore(
    cb => engine.subscribe(cb),
    () => ({
      state:   engine.state,
      rows:    engine.rows,
      columns: engine.columns,
      sort:    engine.sort,
      error:   engine.error,
    }),
  )

  const hasActions = Boolean(onEdit || onDelete || renderActions)
  const colSpan    = snap.columns.length + (hasActions ? 1 : 0)

  if (snap.state === 'error') {
    return <div className="table-error" role="alert">{snap.error}</div>
  }

  return (
    <div className="table-wrap">
      <table className="data-table" aria-busy={snap.state === 'loading'}>
        <thead>
          <tr>
            {snap.columns.map(col => {
              const active    = snap.sort.find(s => s.field === col.key)
              const sortable  = col.sortable !== false
              return (
                <th
                  key={col.key}
                  className={sortable ? 'col-sortable' : undefined}
                  aria-sort={active ? (active.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={sortable ? () => engine.setSort(col.key) : undefined}
                >
                  {col.label}
                  {active && (
                    <span className="sort-indicator" aria-hidden="true">
                      {active.dir === 'asc' ? ' ↑' : ' ↓'}
                    </span>
                  )}
                </th>
              )
            })}
            {hasActions && <th className="col-actions">Actions</th>}
          </tr>
        </thead>

        <tbody>
          {snap.rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className={snap.state === 'loading' ? 'cell-loading' : 'cell-empty'}>
                {snap.state === 'loading' ? 'Loading…' : 'No records found.'}
              </td>
            </tr>
          ) : (
            snap.rows.map((row, i) => (
              <tr
                key={(row['id'] as string | number | undefined) ?? i}
                className={snap.state === 'loading' ? 'row-stale' : undefined}
              >
                {snap.columns.map(col => (
                  <td key={col.key}>
                    {col.render
                      ? col.render(row[col.key], row as Record<string, unknown>)
                      : renderCell(row[col.key])
                    }
                  </td>
                ))}
                {hasActions && (
                  <td className="cell-actions">
                    {renderActions
                      ? renderActions(row as T)
                      : <>
                          {onEdit   && <button type="button" className="btn-action btn-edit"   onClick={() => onEdit(row as T)}>Edit</button>}
                          {onDelete && <button type="button" className="btn-action btn-delete" onClick={() => onDelete(row as T)}>Delete</button>}
                        </>
                    }
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function renderCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined)
    return <span className="cell-null">—</span>
  if (typeof value === 'boolean')
    return <span className={`cell-bool cell-bool--${value}`}>{value ? '✓' : '✗'}</span>
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value))
    return new Date(value).toLocaleDateString()
  if (typeof value === 'object')
    return <span className="cell-json">{JSON.stringify(value)}</span>
  return String(value)
}
