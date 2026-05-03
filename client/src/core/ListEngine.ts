import type {
  ApiResponse, ColumnDef, FilterState, FormSchema,
  ListEngineConfig, ListEngineState, ListMeta, SortState,
} from './types.js'

export class ListEngine<T extends Record<string, unknown> = Record<string, unknown>> {
  state:   ListEngineState = 'loading'
  rows:    T[]             = []
  columns: ColumnDef[]     = []
  meta:    ListMeta
  sort:    SortState[]     = []
  filters: FilterState[]   = []
  error:   string | null   = null

  private readonly config:   ListEngineConfig
  private readonly listeners = new Set<() => void>()
  private page: number

  constructor(config: ListEngineConfig) {
    this.config  = config
    this.page    = 1
    this.meta    = { total: 0, page: 1, pageSize: config.pageSize ?? 20, hasNext: false }
    this.sort    = config.defaultSort ?? []

    if (config.columns) {
      this.columns = config.columns
      void this.fetchData()
    } else {
      void this.fetchSchemaAndData()
    }
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────────

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void { this.listeners.forEach(fn => fn()) }

  // ── Navigation ────────────────────────────────────────────────────────────────

  goToPage(page: number): void {
    this.page = page
    void this.fetchData()
  }

  nextPage(): void { if (this.meta.hasNext) this.goToPage(this.page + 1) }
  prevPage(): void { if (this.page > 1)     this.goToPage(this.page - 1) }
  refresh():  void { void this.fetchData() }

  // ── Sort ──────────────────────────────────────────────────────────────────────

  /** Click once → asc. Click again → desc. Click a third time → remove. */
  setSort(field: string): void {
    const existing = this.sort.find(s => s.field === field)
    if (!existing) {
      this.sort = [{ field, dir: 'asc' }, ...this.sort]
    } else if (existing.dir === 'asc') {
      this.sort = this.sort.map(s => s.field === field ? { ...s, dir: 'desc' as const } : s)
    } else {
      this.sort = this.sort.filter(s => s.field !== field)
    }
    this.page = 1
    void this.fetchData()
  }

  // ── Filters ───────────────────────────────────────────────────────────────────

  setFilter(field: string, op: string, value: string): void {
    const rest   = this.filters.filter(f => f.field !== field)
    this.filters = value ? [...rest, { field, op, value }] : rest
    this.page    = 1
    void this.fetchData()
  }

  clearFilter(field: string): void { this.setFilter(field, 'eq', '') }

  clearFilters(): void {
    this.filters = []
    this.page    = 1
    void this.fetchData()
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  private buildUrl(): string {
    const p = new URLSearchParams()
    p.set('page',     String(this.page))
    p.set('pageSize', String(this.meta.pageSize))

    if (this.sort.length) {
      p.set('sort', this.sort.map(s => (s.dir === 'desc' ? '-' : '') + s.field).join(','))
    }

    for (const f of this.filters) {
      const key = f.op === 'eq' ? `filter[${f.field}]` : `filter[${f.field}][${f.op}]`
      p.set(key, f.value)
    }

    return `${this.config.endpoint}?${p.toString()}`
  }

  private async fetchSchemaAndData(): Promise<void> {
    try {
      const res  = await fetch(`${this.config.endpoint}/schema`)
      const json = await res.json() as ApiResponse<FormSchema>
      if (json.ok) {
        this.columns = json.data.fields.map(f => ({ key: f.name, label: f.label, sortable: true }))
      }
    } catch { /* schema errors are non-fatal; columns will just be empty */ }
    await this.fetchData()
  }

  private async fetchData(): Promise<void> {
    this.state = 'loading'
    this.notify()
    try {
      const res  = await fetch(this.buildUrl())
      const json = await res.json() as ApiResponse<T[]> & { meta?: ListMeta }
      if (json.ok) {
        this.rows  = json.data
        this.meta  = { ...this.meta, ...json.meta, page: this.page }
        this.state = 'loaded'
        this.error = null
      } else {
        this.state = 'error'
        this.error = (json as { errors?: { _root?: string[] } }).errors?._root?.[0] ?? 'Failed to load'
      }
    } catch {
      this.state = 'error'
      this.error = 'Network error — please try again'
    }
    this.notify()
  }
}
