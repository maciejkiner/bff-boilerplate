export type FilterOperator = 'eq' | 'neq' | 'like' | 'gt' | 'gte' | 'lt' | 'lte' | 'isNull' | 'in'

export interface FilterClause {
  field:  string
  op:     FilterOperator
  value:  string
  values?: string[]
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

const VALID_OPS = new Set<string>(['eq', 'neq', 'like', 'gt', 'gte', 'lt', 'lte', 'isNull', 'in'])

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
      const op = withOp[2]! as FilterOperator
      const clause: FilterClause = { field: withOp[1]!, op, value }
      if (op === 'in') clause.values = value.split(',').filter(Boolean)
      filters.push(clause)
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
