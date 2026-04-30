export type FilterOperator = 'eq' | 'like' | 'gt' | 'gte' | 'lt' | 'lte' | 'isNull'

export interface FilterClause {
  field: string
  op:    FilterOperator
  value: string
}

export interface SortClause {
  field: string
  dir:   'asc' | 'desc'
}

export interface ListQuery {
  filters:  FilterClause[]
  sort:     SortClause[]
  page:     number
  pageSize: number
}

export interface PagedMeta {
  total:    number
  page:     number
  pageSize: number
  hasNext:  boolean
}

const VALID_OPS = new Set<string>(['eq', 'like', 'gt', 'gte', 'lt', 'lte', 'isNull'])

export function parseListQuery(rawUrl: string): ListQuery {
  const params = new URLSearchParams(rawUrl.includes('?') ? rawUrl.split('?')[1] : '')

  const filters: FilterClause[] = []
  for (const [key, value] of params.entries()) {
    // filter[field]=value  →  eq
    const simple = key.match(/^filter\[([A-Za-z_]\w*)\]$/)
    if (simple) {
      filters.push({ field: simple[1]!, op: 'eq', value })
      continue
    }
    // filter[field][op]=value
    const withOp = key.match(/^filter\[([A-Za-z_]\w*)\]\[([A-Za-z]+)\]$/)
    if (withOp && VALID_OPS.has(withOp[2]!)) {
      filters.push({ field: withOp[1]!, op: withOp[2]! as FilterOperator, value })
    }
  }

  const sortRaw = params.get('sort') ?? ''
  const sort: SortClause[] = sortRaw
    ? sortRaw.split(',').filter(Boolean).map(s =>
        s.startsWith('-')
          ? { field: s.slice(1), dir: 'desc' as const }
          : { field: s,          dir: 'asc'  as const }
      )
    : []

  const page     = Math.max(1,   Number(params.get('page')     ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize') ?? 20)))

  return { filters, sort, page, pageSize }
}
