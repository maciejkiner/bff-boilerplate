# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # tsc — must stay clean at all times
npm run dev            # tsx watch src/index.ts
npm run db:generate    # drizzle-kit generate (after schema changes)
npm run db:migrate     # drizzle-kit migrate
npm run db:studio      # Drizzle Studio GUI
```

Always run `npm run build` after any change to verify types. There is no test runner configured — use `tsx` to run individual test files directly.

## Architecture

Three entry points for app builders:

| Primitive | File | Use when |
|---|---|---|
| `BaseCrud` | `core/crud/BaseCrud.ts` | Standard domain table (companies, users, products) |
| `SubmissionResource` | `core/submission/SubmissionResource.ts` | Stateful form with draft/submit/approve lifecycle |
| `defineWorkflow` | `core/workflow/defineWorkflow.ts` | State machine attached to a SubmissionResource |

### Directory layout

```
src/
  core/
    form/           FormDefinition, validateForm, handleForm, field builders, messages
    crud/           BaseCrud, listQuery (filter/sort/page parsing)
    model/          ModelBase (Drizzle generic CRUD base)
    submission/     SubmissionModel, SubmissionResource, types
    workflow/       defineWorkflow, WorkflowRegistry, WorkflowScheduler, guards
    routing/        ResourceRegistry, response helpers (ok / okPaged / fail)
    audit/          AuditLogger, AuditRoutes
    validators/     ValidatorRegistry, built-in validators (nip, pesel, iban, …)
    testing/        FormTestKit, WorkflowTestKit, IntegrationTestKit, snapshot utils
  resources/        one folder per domain resource (model + form + resource)
  db/               schema.ts (Drizzle table definitions), index.ts (db instance)
  middleware/       auth.ts (JWT), errorHandler.ts
  index.ts          app entry — wires middleware, registry, workflows, audit routes
```

## Adding a Resource (3-file pattern)

**1. `db/schema.ts`** — add a `pgTable` definition, then run `db:generate` + `db:migrate`.

**2. `resources/things/model.ts`**
```typescript
import { things } from '../../db/schema.js'
import { ModelBase } from '../../core/model/ModelBase.js'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

export type Thing       = InferSelectModel<typeof things>
export type ThingInsert = InferInsertModel<typeof things>

export class ThingModel extends ModelBase<typeof things, ThingInsert, Thing> {
  readonly table = things
}
```

**3. `resources/things/form.ts`**
```typescript
import { defineForm, text, number, select } from '../../core/form/index.js'
import type { ThingInsert } from './model.js'

export const thingForm = defineForm<ThingInsert>([
  text('name', { label: 'Name', required: true, maxLength: 100, filterable: true, sortable: true }),
])
```

**4. `resources/things/resource.ts`**
```typescript
import { BaseCrud } from '../../core/crud/BaseCrud.js'
import { ThingModel, type Thing, type ThingInsert } from './model.js'
import { thingForm } from './form.js'
import { things } from '../../db/schema.js'

export class ThingsResource extends BaseCrud<typeof things, ThingInsert, Thing> {
  readonly model = new ThingModel()
  readonly form  = thingForm
}
```

**5. `index.ts`** — `registry.register('things', ThingsResource)`

This gives you `GET/POST/PUT/PATCH/DELETE /things`, `GET /things/schema`, `POST /things/schema/evaluate`, and `POST /things/bulk`.

## Form Pipeline

```
defineForm([fields], { rules, steps, asyncValidators, messages })
  → FormDefinition<TInput>

validateForm(form, payload, context, options)
  → strips invisible/non-editable fields
  → Zod schema safeParse
  → unique checks (DB)
  → cross-field rules
  → named validators (registry)
  → async validators
  → { ok, data } | { ok, errors }

handleForm(form, model, body, id?, validationContext?, user?)
  → validateForm(...)
  → model.save(data, id?)
  → { state: 'created'|'updated'|'error', data?, errors? }
```

`BaseCrud.create()` / `update()` call `handleForm`. `partialUpdate()` calls `validateForm` directly on scoped fields.

## Key TypeScript Patterns

**`exactOptionalPropertyTypes: true` is enabled.** Never spread optional properties directly:
```typescript
// WRONG — TS error
const ctx = { values, ...(user ? { user } : undefined) }

// CORRECT
const ctx = { values, ...(user ? { user } : {}) }
```

**Drizzle generic table type** — always use `PgTableWithColumns<any>` as the type bound:
```typescript
abstract model: ModelBase<PgTableWithColumns<any>, TInput, TSelect>
```

**`ComputedFieldDef` does not extend `BaseFieldDef`** — always guard before accessing `BaseFieldDef` properties:
```typescript
if (field.type === 'computed') continue   // then access field.editable, field.validators, etc.
```

Same applies to `FieldGroupDef` for `filterable` / `sortable` (groups are never filterable).

## Lifecycle Hooks (BaseCrud)

Override in your resource subclass. `before*` hooks return data — modify and return a new copy:

```typescript
protected override async beforeList(query: ListQuery, ctx: Context): Promise<ListQuery>
protected override async beforeCreate(body: unknown, ctx: Context): Promise<unknown>
protected override async afterCreate(record: TSelect, ctx: Context): Promise<void>
protected override async beforeUpdate(id: number, body: unknown, ctx: Context): Promise<unknown>
protected override async afterUpdate(record: TSelect, ctx: Context): Promise<void>
protected override async beforeDelete(id: number, ctx: Context): Promise<void>
protected override getValidationContext(ctx: Context): ValidationContext  // 'submit' by default
```

Use `beforeList` for tenant-scoping or search filters. Use `beforeCreate` to inject user/tenant IDs. Throw inside a hook to abort with a 500; return `ctx.json(fail(...), 422)` + return for user-facing errors.

## Nested Resources

```typescript
export class ContactsResource extends BaseCrud<...> {
  readonly parentField = 'company_id'  // FK column injected automatically
  protected override async parentExists(parentId: number, ctx: Context) {
    return !!(await new CompanyModel().get(parentId))
  }
}
registry.register('companies/:companyId/contacts', ContactsResource)
```

## Adding a Workflow

```typescript
import { defineWorkflow, requireRole } from '../core/workflow/index.js'

export const myWorkflow = defineWorkflow({
  name:    'my_process',
  initial: 'draft',
  states: [
    { name: 'draft',     type: 'initial' },
    { name: 'submitted', type: 'intermediate' },
    { name: 'approved',  type: 'final' },
  ],
  transitions: [
    { name: 'submit', from: 'draft',      to: 'submitted' },
    { name: 'approve', from: 'submitted', to: 'approved',
      guards: [requireRole('manager')],
      onTransition: async (ctx) => { /* side effect */ },
    },
  ],
})
```

Attach to a `SubmissionResource`:
```typescript
export class MyResource extends SubmissionResource {
  readonly formName = 'my_process'
  readonly form     = myForm
  readonly workflow = myWorkflow
}
```

Workflow graph served at `GET /workflows/my_process/graph` after registering:
```typescript
workflows.register(myWorkflow)
workflows.mount(app)
```

## Auth

`authMiddleware` (JWT Bearer) is applied to all routes except `/health` and `/static/*` in `index.ts`. `ctx.get('user')` returns `{ id: number; role: string }` or `undefined`. JWT is signed with `process.env.JWT_SECRET`.

For integration tests, use `seed.createUser({ role: 'admin' })` which signs a token with the same secret without needing a database row.

## Testing Patterns

**Unit (form logic)** — `FormTestKit.fill(form, values).expectValid()`. No DB, no HTTP.

**Unit (workflow)** — `WorkflowTestKit.start(wf).inState('submitted').as(manager).transition('approve').then(r => r.toSucceed())`. No DB.

**Integration** — `TestClient(app)` + `seed.*` + `testDb.truncateAll()` in `beforeEach`. Requires a real Postgres DB (`DATABASE_URL` pointing to a test database). Always truncate in `beforeEach`, not `afterEach`, so failed tests leave data visible for debugging.

**Schema regression** — `expect(schemaSnapshot(myForm)).toMatchSnapshot()` catches unintended field changes.

## Response Envelope

All endpoints return:
```json
{ "ok": true,  "data": { ... } }
{ "ok": true,  "data": [...], "meta": { "total": 100, "page": 1, "pageSize": 20, "hasNext": true } }
{ "ok": false, "errors": { "fieldName": ["message"], "_root": ["form-level error"] } }
```

Use `ok(data)`, `okPaged(rows, meta)`, `fail(errors)` from `core/routing/index.js`.

## DB Schema Notes

After adding columns to `db/schema.ts`, always run `db:generate` then `db:migrate`.

Current non-obvious columns on `form_submissions`:
- `workflow_state_entered_at` — set on every `setWorkflowState()` call; used by `WorkflowScheduler` for TTL checks
- `workflow_branches` — JSONB `{ branchName: currentState }` for parallel branch tracking
- `deleted_at` — soft delete; all queries automatically exclude rows where `deleted_at IS NOT NULL`
