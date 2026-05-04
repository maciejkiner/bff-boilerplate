import { useSyncExternalStore, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from '@tanstack/react-table'
import type { ListEngine } from '../core/ListEngine.js'
import type { ColumnDef } from '../core/types.js'

interface DataTableProps<T extends Record<string, unknown>> {
  engine:         ListEngine<T>
  onEdit?:        (row: T) => void
  onDelete?:      (row: T) => void
  onBulkDelete?:  (rows: T[]) => void
  /** Provide to fully replace the default edit/delete buttons per row. */
  renderActions?: (row: T) => React.ReactNode
}

const helper = createColumnHelper<Record<string, unknown>>()

function buildTanstackColumns(
  cols:          ColumnDef[],
  onSort:        (key: string) => void,
  sortState:     Array<{ field: string; dir: 'asc' | 'desc' }>,
  onEdit?:       (row: Record<string, unknown>) => void,
  onDelete?:     (row: Record<string, unknown>) => void,
  renderActions?:(row: Record<string, unknown>) => React.ReactNode,
) {
  const hasActions = Boolean(onEdit || onDelete || renderActions)

  const dataCols = cols.map(col => {
    const active = sortState.find(s => s.field === col.key)
    return helper.accessor(col.key, {
      id:     col.key,
      header: () => (
        <span
          className={col.sortable !== false ? 'col-sortable' : undefined}
          aria-sort={active ? (active.dir === 'asc' ? 'ascending' : 'descending') : undefined}
          onClick={col.sortable !== false ? () => onSort(col.key) : undefined}
          style={{ cursor: col.sortable !== false ? 'pointer' : undefined }}
        >
          {col.label}
          {active && (
            <span className="sort-indicator" aria-hidden="true">
              {active.dir === 'asc' ? ' ↑' : ' ↓'}
            </span>
          )}
        </span>
      ),
      cell: info => col.render
        ? col.render(info.getValue(), info.row.original)
        : renderCell(info.getValue()),
    })
  })

  if (!hasActions) return dataCols

  const actionCol = helper.display({
    id:     '_actions',
    header: () => <span className="col-actions">Actions</span>,
    cell:   info => (
      <div className="cell-actions">
        {renderActions
          ? renderActions(info.row.original)
          : <>
              {onEdit   && <button type="button" className="btn-action btn-edit"   onClick={() => onEdit(info.row.original)}>Edit</button>}
              {onDelete && <button type="button" className="btn-action btn-delete" onClick={() => onDelete(info.row.original)}>Delete</button>}
            </>
        }
      </div>
    ),
  })

  return [...dataCols, actionCol]
}

export function DataTable<T extends Record<string, unknown>>({
  engine,
  onEdit,
  onDelete,
  onBulkDelete,
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

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const selectionCol = onBulkDelete
    ? [helper.display({
        id:     '_select',
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label="Select row"
          />
        ),
      })]
    : []

  const columns = [
    ...selectionCol,
    ...buildTanstackColumns(
      snap.columns,
      key => engine.setSort(key),
      snap.sort,
      onEdit   ? (row => onEdit(row as T))   : undefined,
      onDelete ? (row => onDelete(row as T)) : undefined,
      renderActions ? (row => renderActions(row as T)) : undefined,
    ),
  ]

  const table = useReactTable({
    data:             snap.rows as Record<string, unknown>[],
    columns,
    state:            { rowSelection },
    onRowSelectionChange: setRowSelection,
    getCoreRowModel:  getCoreRowModel(),
    getRowId:         row => String(row['id'] ?? Math.random()),
    enableRowSelection: Boolean(onBulkDelete),
  })

  const selectedRows = table.getSelectedRowModel().rows.map(r => r.original as T)
  const colSpan      = columns.length

  if (snap.state === 'error') {
    return <div className="table-error" role="alert">{snap.error}</div>
  }

  return (
    <>
      {onBulkDelete && selectedRows.length > 0 && (
        <div className="table-bulk-actions">
          <button
            type="button"
            className="btn-action btn-delete"
            onClick={() => { onBulkDelete(selectedRows); setRowSelection({}) }}
          >
            Delete {selectedRows.length} selected
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table" aria-busy={snap.state === 'loading'}>
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => (
                  <th key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className={snap.state === 'loading' ? 'cell-loading' : 'cell-empty'}>
                  {snap.state === 'loading' ? 'Loading…' : 'No records found.'}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr
                  key={row.id}
                  className={snap.state === 'loading' ? 'row-stale' : undefined}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
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
