import type { ListMeta } from '../core/types.js'

interface PaginationProps {
  meta:      ListMeta
  onPage:    (page: number) => void
  /** Maximum page number buttons to show. Default: 5 */
  maxPages?: number
}

export function Pagination({ meta, onPage, maxPages = 5 }: PaginationProps) {
  const totalPages = Math.ceil(meta.total / meta.pageSize)
  if (totalPages <= 1) return null

  const half  = Math.floor(maxPages / 2)
  const start = Math.max(1, Math.min(meta.page - half, totalPages - maxPages + 1))
  const end   = Math.min(totalPages, start + maxPages - 1)
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i)

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="pagination-btn"
        onClick={() => onPage(meta.page - 1)}
        disabled={meta.page <= 1}
        aria-label="Previous page"
      >
        ‹
      </button>

      {start > 1 && (
        <>
          <button type="button" className="pagination-btn" onClick={() => onPage(1)}>1</button>
          {start > 2 && <span className="pagination-ellipsis" aria-hidden="true">…</span>}
        </>
      )}

      {pages.map(p => (
        <button
          key={p}
          type="button"
          className={`pagination-btn${p === meta.page ? ' pagination-btn--active' : ''}`}
          onClick={() => onPage(p)}
          aria-current={p === meta.page ? 'page' : undefined}
        >
          {p}
        </button>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="pagination-ellipsis" aria-hidden="true">…</span>}
          <button type="button" className="pagination-btn" onClick={() => onPage(totalPages)}>
            {totalPages}
          </button>
        </>
      )}

      <button
        type="button"
        className="pagination-btn"
        onClick={() => onPage(meta.page + 1)}
        disabled={!meta.hasNext}
        aria-label="Next page"
      >
        ›
      </button>

      <span className="pagination-info" aria-live="polite">
        {meta.total.toLocaleString()} total · page {meta.page} of {totalPages}
      </span>
    </nav>
  )
}
