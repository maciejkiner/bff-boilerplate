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

Always run `npm run build` after any change to verify types.

```bash
npm test                # vitest run (unit + integration; integration skips when DATABASE_URL is unset)
```

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
    auth/           AuthProvider interface, createAuthMiddleware, providers/, AuthPolicy, issueTokens
    form/           FormDefinition, validateForm, handleForm, field builders, messages
    crud/           BaseCrud, TenantBaseCrud, listQuery (filter/sort/page parsing)
    model/          ModelBase (Drizzle generic CRUD base)
    submission/     SubmissionModel, SubmissionResource, types
    workflow/       defineWorkflow, WorkflowRegistry, WorkflowScheduler, guards
    routing/        ResourceRegistry, response helpers (ok / okPaged / fail)
    audit/          AuditLogger, AuditRoutes
    validators/     ValidatorRegistry, built-in validators (nip, pesel, iban, …)
    testing/        FormTestKit, WorkflowTestKit, IntegrationTestKit, snapshot utils
  resources/
    auth/           authRoutes.ts (login/register/logout/refresh/me/change-password), oauthRoutes.ts
    users/          example resource (model + form + resource)
  db/               schema.ts (Drizzle table definitions), index.ts (db instance)
  middleware/       auth.ts (re-exports from core/auth — kept for backwards compat), errorHandler.ts
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

Auth uses a **plugin provider chain**. `app.ts` applies a global `authMiddleware` built from one or more `AuthProvider` implementations. Providers are tried in order — first non-null result wins; a thrown error short-circuits with 401.

```typescript
import { createAuthMiddleware, JwtAuthProvider, ApiKeyAuthProvider } from './core/auth/index.js'

// Default (JWT only):
app.use('*', createAuthMiddleware(new JwtAuthProvider(config)))

// JWT + API key fallback:
app.use('*', createAuthMiddleware(
  new JwtAuthProvider(config),
  new ApiKeyAuthProvider(),
))
```

**Built-in providers** (`core/auth/providers/`):
- `JwtAuthProvider` — reads `Authorization: Bearer`, verifies HS256, checks `revoked_jtis` table. Accepts `claimsMap` option to map JWT payload fields onto `AuthUser`.
- `ApiKeyAuthProvider` — reads `X-API-Key`, SHA-256 hash lookup in `api_keys` table.
- `LocalAuthProvider` — reads `{ email, password }` JSON body, bcrypt compare against `user_credentials`. **Use only on the login endpoint**, not in the global chain.

**Token lifecycle** (`core/auth/issueTokens.ts`):
- `issueTokenPair(userId, role, extra?)` — issues short-lived access token (default 15 min) + long-lived refresh token (default 7 days, stored as SHA-256 hash).
- `refreshAccessToken(rawToken)` — rotation: revokes used token, re-fetches user, issues new access token.
- `revokeJti`, `revokeRefreshToken`, `revokeAllUserTokens`, `cleanupExpiredJtis`.

**Auth endpoints** (mounted publicly in `app.ts` before global auth, via `mountAuthRoutes`):
```
POST /auth/register        { email, name, password }         → 201 { user, accessToken, refreshToken }
POST /auth/login           { email, password }               → 200 { user, accessToken, refreshToken }
POST /auth/refresh         { refresh_token }                 → 200 { accessToken }
POST /auth/logout          { refresh_token?, revoke_all? }   → 200  (JWT required)
GET  /auth/me                                                → 200 { user }  (JWT required)
POST /auth/change-password { current_password, new_password }→ 200  (JWT required, revokes all tokens)
```

**OAuth** — scaffold in `resources/auth/oauthRoutes.ts`. Uncomment the provider block and call `mountOAuthRoutes(app)` after installing `arctic`.

**`ctx.get('user')`** returns `AuthUser | undefined` — `{ id: number; role: string; [key: string]: unknown }`. Use `typedAuthUser<MyUser>(ctx)` from `core/auth/index.js` for typed custom claims.

**DB tables added for auth:** `user_credentials`, `refresh_tokens`, `revoked_jtis`, `api_keys`, `oauth_accounts`.

For integration tests, use `seed.createUser({ role: 'admin' })` which signs a token with the same secret without needing a database row. Ensure tokens include `jti`, `exp`, and `iat` claims to match `JwtAuthProvider` expectations.

## Multi-tenancy

Extend `TenantBaseCrud` instead of `BaseCrud`. Set `tenantField` (DB column) and ensure `tenant_id` (or override `tenantIdClaim`) is present in the JWT via `claimsMap`:

```typescript
export class OrdersResource extends TenantBaseCrud<typeof orders, OrderInsert, Order> {
  readonly model       = new OrderModel()
  readonly form        = orderForm
  readonly tenantField = 'org_id'  // column on `orders` table
}

// In app.ts wire:
new JwtAuthProvider(config, { claimsMap: { tenant_id: p => p['tid'] } })
```

All list/get/create/update/delete calls are automatically scoped to the caller's tenant.

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
