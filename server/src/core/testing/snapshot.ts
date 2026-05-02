import type { FormContext, FormDefinition, FormSchema } from '../form/types.js'
import type { WorkflowInstance } from '../workflow/types.js'

// ── Stable JSON serializer ─────────────────────────────────────────────────────
// Produces alphabetically-sorted, deterministic output suitable for snapshot assertions.

function stableStringify(value: unknown): string {
  return JSON.stringify(value, sortKeys, 2)
}

function sortKeys(_: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    )
  }
  return value
}

// ── Form schema snapshot ───────────────────────────────────────────────────────

export function schemaSnapshot<T>(
  form: FormDefinition<T>,
  ctx?: Partial<FormContext<T>>,
): string {
  return stableStringify(form.toSchema(ctx))
}

export function parseSchemaSnapshot(snapshot: string): FormSchema {
  return JSON.parse(snapshot) as FormSchema
}

// ── Workflow graph snapshot ────────────────────────────────────────────────────

export function graphSnapshot(workflow: WorkflowInstance): string {
  return stableStringify(workflow.toGraph())
}

export function diffSchemaSnapshots(
  before: string,
  after: string,
): { added: string[]; removed: string[]; changed: string[] } {
  const parse = (s: string) => {
    const schema = JSON.parse(s) as FormSchema
    return Object.fromEntries(schema.fields.map(f => [f.name, f]))
  }
  const a = parse(before)
  const b = parse(after)
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
  const added:   string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const key of allKeys) {
    if (!(key in a))       added.push(key)
    else if (!(key in b))  removed.push(key)
    else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changed.push(key)
  }
  return { added, removed, changed }
}
