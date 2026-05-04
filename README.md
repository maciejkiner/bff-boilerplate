# BFF Boilerplate

A lightweight TypeScript Backend-for-Frontend framework built around three core primitives: **fluent form handling**, **CRUD resources**, and **a thin model layer**. Inspired by a PHP framework built for ROPA/company management, redesigned for modern TypeScript.

---

## Tech Stack

### Backend
| Layer | Library |
|---|---|
| HTTP / Routing | [Hono](https://hono.dev) |
| Database ORM | [Drizzle](https://orm.drizzle.team) |
| Validation | [Zod](https://zod.dev) |
| Runtime | Node.js 22 |
| Language | TypeScript 5 (strict) |
| Database | PostgreSQL 16 |

### Frontend
| Layer | Library |
|---|---|
| UI | [React 18](https://react.dev) |
| Bundler | [esbuild](https://esbuild.github.io) |
| Form engine | Custom TS (zero deps) |

---

## Architecture

```
package.json                 workspace root — orchestrates server + client
server/                      BACKEND
  src/
    core/
      model/      ModelBase       — get / getByField / getAll / save / delete
      form/       FormBuilder     — fluent Zod-backed form definition
                  handleForm      — validates payload, runs unique checks, saves, returns typed state
      crud/       BaseCrud        — base resource class wiring model + form to HTTP handlers
      routing/    ResourceRegistry — mounts CRUD routes onto Hono; response helpers ok() / fail()
    resources/    your domain resources (one folder per resource)
    middleware/   auth, errorHandler
    db/           Drizzle schema + db instance
    index.ts      app entry point

client/                      FRONTEND
  src/
    core/
      FormEngine.ts   — pure TS state machine (idle→submitting→created/updated/error)
                        handles fetch, error mapping, edit mode — zero React dependency
    react/
      useFormEngine   — React 18 hook via useSyncExternalStore
      FormController  — renders fields from config, disables submit while in-flight
      fields/         — TextField, TextareaField, SelectField, CheckboxField
    resources/        — per-resource field configs (mirrors backend form definitions)
  dist/index.html     — served at /static/
```

### Request flow

```
POST /users
  → Hono router
  → UsersResource.create()        (inherits from BaseCrud)
  → handleForm(userForm, model, body)
      → Zod validation
      → unique constraint checks
      → model.save(data)
  → { ok: true, data: User }
```

### Response envelope

Every endpoint returns the same shape:

```json
{ "ok": true,  "data": { ... } }
{ "ok": true,  "data": [...], "meta": { "total": 100, "page": 1, "pageSize": 20, "hasNext": true } }
{ "ok": false, "errors": { "field": ["message"] } }
```

List endpoints always include `meta` with pagination info.

---

## Getting Started

### 1. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` to a strong random value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Important:** `.env.example` contains `localhost:5432` for the database host. If you run the server with Docker (`docker-compose up`), change it to `db:5432` (the service name inside the Docker network). If you run the server directly with `npm run dev`, keep `localhost:5432`.

### 2. Start with Docker

```bash
docker-compose up --build
```

This starts Postgres and the app. The API is available at `http://localhost:3000`.

### 3. Run migrations

```bash
npm run db:generate
npm run db:migrate
```

### 4. Health check

```bash
curl http://localhost:3000/health
# → { "ok": true }
```

### 5. Open the demo UI

```
http://localhost:3000/static/index.html
```

Shows a user form in edit mode (pre-populated with a sample user). Comment out the `engine.load()` call in `client/src/index.tsx` to test create mode.

---

## Adding a New Resource

### 1. Add a table to `server/src/db/schema.ts`

```ts
export const users = pgTable('users', {
  id:         serial('id').primaryKey(),
  email:      varchar('email', { length: 200 }).notNull().unique(),
  name:       varchar('name',  { length: 100 }).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})
```

### 2. Create `server/src/resources/users/model.ts`

```ts
import { users } from '../../db/schema.js'
import { ModelBase } from '../../core/model/ModelBase.js'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

export type User       = InferSelectModel<typeof users>
export type UserInsert = InferInsertModel<typeof users>

export class UserModel extends ModelBase<typeof users, UserInsert, User> {
  readonly table = users
}
```

### 3. Create `server/src/resources/users/form.ts`

```ts
import { defineForm, text, email } from '../../core/form/index.js'
import type { UserInsert } from './model.js'

export const userForm = defineForm<UserInsert>([
  text('name',   { label: 'Name',  required: true, maxLength: 100 }),
  email('email', { label: 'Email', required: true, unique: { field: 'email', table: 'users', column: 'email' } }),
])
```

### 4. Create `server/src/resources/users/resource.ts`

```ts
import { BaseCrud } from '../../core/crud/BaseCrud.js'
import { UserModel, type User, type UserInsert } from './model.js'
import { userForm } from './form.js'
import { users } from '../../db/schema.js'

export class UsersResource extends BaseCrud<typeof users, UserInsert, User> {
  readonly model = new UserModel()
  readonly form  = userForm
}
```

### 5. Register in `server/src/index.ts`

```ts
import { UsersResource } from './resources/users/resource.js'

registry
  .register('users', UsersResource)
  .mount(app)
```

That gives you:

```
GET    /users
GET    /users/:id
POST   /users
PUT    /users/:id
PATCH  /users/:id
DELETE /users/:id
```

---

## Partial Update (PATCH)

`PATCH /:resource/:id` validates and saves **only the fields present in the request body**, merging them with the existing record. Cross-field rules are applied only when all their referenced fields are included.

```bash
PATCH /users/1
{ "name": "Jan Kowalski" }
# validates only the 'name' field, updates only that column
```

---

## Filtering, Sorting & Pagination

All `GET /:resource` list endpoints support filtering, sorting, and offset-based pagination via query parameters — no extra code required.

### Filtering

```
GET /users?filter[name][like]=jan
GET /users?filter[role]=admin&filter[name][like]=ko
```

Supported operators:

| Operator | Meaning |
|---|---|
| *(none / default)* | `eq` — exact match |
| `eq` | exact match |
| `like` | `LIKE %value%` |
| `gt` / `gte` | greater than / greater or equal |
| `lt` / `lte` | less than / less or equal |
| `isNull` | column IS NULL (value ignored) |

Unknown fields and invalid operators are silently ignored.

### Sorting

```
GET /users?sort=name           # ascending
GET /users?sort=-createdAt     # descending
GET /users?sort=-createdAt,name  # multiple
```

### Pagination

```
GET /users?page=2&pageSize=10
```

Defaults: `page=1`, `pageSize=20`. Maximum `pageSize` is 100.

Response includes a `meta` object:

```json
{
  "ok": true,
  "data": [...],
  "meta": { "total": 47, "page": 2, "pageSize": 10, "hasNext": true }
}
```

---

## Lifecycle Hooks

Override any hook in your resource subclass to inject behaviour at each stage. `before*` hooks receive and return data — return a modified copy to transform the payload, or throw to abort. `after*` hooks are fire-and-forget.

```ts
export class UsersResource extends BaseCrud<typeof users, UserInsert, User> {
  readonly model = new UserModel()
  readonly form  = userForm

  // Scope list to active users only
  protected override async beforeList(query: ListQuery, ctx: Context) {
    return { ...query, filters: [...query.filters, { field: 'active', op: 'eq' as const, value: 'true' }] }
  }

  // Normalise email before validation
  protected override async beforeCreate(body: unknown, ctx: Context) {
    const b = body as Record<string, unknown>
    return { ...b, email: typeof b['email'] === 'string' ? b['email'].toLowerCase() : b['email'] }
  }

  // Send welcome email after user is created
  protected override async afterCreate(record: User, _ctx: Context) {
    await notify(`Welcome ${record.name}!`)
  }

  // Prevent deletion of admin users
  protected override async beforeDelete(id: number, _ctx: Context) {
    const row = await this.model.get(id)
    if (row?.role === 'admin') throw new Error('Cannot delete an admin user')
  }
}
```

Available hooks: `beforeList`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`.

---

## Overriding Default Handlers

Override any handler method directly when you need full control:

```ts
export class UsersResource extends BaseCrud<typeof users, UserInsert, User> {
  readonly model = new UserModel()
  readonly form  = userForm

  override async list(ctx: Context): Promise<Response> {
    const query  = parseListQuery(ctx.req.url)
    const result = await this.model.list(query)
    return ctx.json(okPaged(result.rows, {
      total: result.total, page: query.page, pageSize: query.pageSize,
      hasNext: query.page * query.pageSize < result.total,
    }))
  }
}
```

---

## Form Submissions (stateful lifecycle)

`SubmissionResource` stores form data as JSONB in a `form_submissions` table, separate from your domain tables. Use it when you need draft saving, status tracking, or an approval workflow.

### Status lifecycle

```
draft → submitted → locked → archived
  ↑                              |
  └──────────── restore ─────────┘
```

- **draft** — editable, validated with `'draft'` context (relaxed rules)
- **submitted** — locked for editing; reached via `POST /:id/submit` which runs full `'submit'` validation
- **locked** — fully read-only
- **archived** — soft-removed; can be restored to `draft`

### Adding a submission resource

```ts
// server/src/resources/leave-requests/resource.ts
import { SubmissionResource } from '../../core/submission/index.js'
import { leaveRequestForm } from './form.js'

export class LeaveRequestsResource extends SubmissionResource {
  readonly formName = 'leave_request'
  readonly form     = leaveRequestForm

  // Inject the authenticated user as creator
  protected override getCreatedBy(ctx: Context) {
    return (ctx.get('user') as { id: number } | undefined)?.id ?? null
  }
}

// server/src/index.ts
const leaveRequests = new LeaveRequestsResource()
leaveRequests.mount(app, '/leave-requests')
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/leave-requests` | List (filterable, paginated, scoped to `form_name`) |
| `GET` | `/leave-requests/:id` | Get single submission |
| `POST` | `/leave-requests` | Create draft (draft validation) |
| `PATCH` | `/leave-requests/:id` | Merge data into draft |
| `DELETE` | `/leave-requests/:id` | Delete draft or archived |
| `POST` | `/leave-requests/:id/submit` | draft → submitted (runs full validation) |
| `POST` | `/leave-requests/:id/lock` | submitted → locked |
| `POST` | `/leave-requests/:id/archive` | any → archived |
| `POST` | `/leave-requests/:id/restore` | archived → draft |

Request body for `POST` / `PATCH`: `{ "data": { ...formFields } }` or the fields directly at the root.

### Version history

Every data-changing operation (`PATCH`, step save) creates an immutable snapshot in `form_submission_versions`.

```bash
GET /leave-requests/42/history          # all versions in ascending order
GET /leave-requests/42/history/3        # snapshot at version 3
```

Each response includes `{ version, data, changed_by, changed_at }`.

---

## Workflow Engine

A standalone code-first state machine. Works independently — attach it to `SubmissionResource` or any other domain object.

```ts
import { defineWorkflow } from './core/workflow/index.js'

export const leaveWorkflow = defineWorkflow({
  name:    'leave_request',
  initial: 'draft',
  states: [
    { name: 'draft',     type: 'initial' },
    { name: 'submitted', type: 'intermediate' },
    { name: 'approved',  type: 'final' },
    { name: 'rejected',  type: 'final' },
  ],
  transitions: [
    { name: 'submit', from: 'draft',      to: 'submitted' },
    {
      name: 'approve', from: 'submitted', to: 'approved',
      guards: [
        { check: (ctx) => ctx.user?.role === 'manager', message: 'Only managers can approve' },
      ],
    },
    {
      name: 'reject',  from: 'submitted', to: 'rejected',
      guards: [
        { check: (ctx) => ctx.user?.role === 'manager', message: 'Only managers can reject' },
      ],
    },
    { name: 'recall', from: 'submitted',  to: 'draft' },
  ],
})
```

### Transition API

```ts
// Execute a transition
const result = await leaveWorkflow.transition('approve', 'submitted', { user: currentUser })
// { ok: true, newState: 'approved' }
// { ok: false, reason: 'guard_failed', message: 'Only managers can approve' }
// { ok: false, reason: 'invalid_transition', message: '...' }

// Check what's available
const available = await leaveWorkflow.availableTransitions('submitted', { user: currentUser })
// returns TransitionDef[] the user can actually execute

// Serialize for visualization
const graph = leaveWorkflow.toGraph()
// { states: [...], transitions: [...] }  — guards stripped from output
```

Guards are async-capable: `check: async (ctx) => await db.hasPermission(ctx.user.id, 'approve')`.

---

## Form Definition API

Forms are defined as a typed array of field objects using `defineForm` + per-type helpers. The definition is a plain inspectable object — Zod schema, unique checks, and field metadata are all derived from it.

```ts
import { defineForm, text, email, number, select, boolean, textarea, url } from './core/form/index.js'

const userForm = defineForm<UserInsert>([
  text('name',     { label: 'Full name',  required: true, maxLength: 100 }),
  email('email',   { label: 'Email',      required: true, unique: { field: 'email', table: 'users', column: 'email' } }),
  number('age',    { label: 'Age',        min: 0, max: 120 }),
  select('role',   { label: 'Role',       required: true, options: [{ value: 'admin', label: 'Admin' }, { value: 'user', label: 'User' }] }),
  url('website',   { label: 'Website' }),
  textarea('bio',  { label: 'Bio',        maxLength: 500 }),
])
```

Each field type only accepts options relevant to that type — TypeScript will catch `maxLength` on a `number` field at definition time.

### Default values

Every field accepts `defaultValue` — a static value or a `(ctx) => value` callback. It is injected before Zod validation when the field is absent from the payload.

```ts
text('status',      { label: 'Status',    defaultValue: 'active' }),
text('assigned_to', { label: 'Assignee',  defaultValue: (ctx) => ctx.user?.id }),
```

### Conditional fields

`visible` and `required` accept a static boolean **or** a callback that receives `FormContext`:

```ts
text('tax_id', {
  label:    'Tax ID',
  visible:  (ctx) => ctx.user?.role === 'admin',
  required: (ctx) => ctx.values.type === 'company',
})
```

Invisible fields are **stripped from the payload before validation** — they never appear in the Zod schema and are never saved.

### Validation context

`ValidationContext` (`'draft' | 'submit' | 'approve' | 'custom'`) travels through `FormContext` so the same form can enforce different strictness per operation:

```ts
text('justification', {
  label:    'Justification',
  required: (ctx) => ctx.validationContext === 'submit',
})
```

`handleForm` defaults to `'submit'`. Override per resource to support draft saves:

```ts
export class LeaveRequestsResource extends BaseCrud<...> {
  readonly model = new LeaveRequestModel()
  readonly form  = leaveRequestForm

  protected override getValidationContext(ctx: Context): ValidationContext {
    return ctx.req.query('draft') === 'true' ? 'draft' : 'submit'
  }
}
```

### Cross-field validation

Rules are passed via the `rules` option. Each rule returns an error string or `null`:

```ts
export const eventForm = defineForm<EventInsert>(
  [
    text('startDate', { label: 'Start date', required: true }),
    text('endDate',   { label: 'End date',   required: true }),
    number('budget',  { label: 'Budget' }),
    number('spent',   { label: 'Spent' }),
  ],
  {
    rules: [
      {
        fields:     ['startDate', 'endDate'],
        errorField: 'endDate',
        validate:   (v) => v.endDate && v.startDate && v.endDate < v.startDate
                      ? 'End date must be after start date' : null,
      },
    ],
  },
)
```

Errors attach to `errorField` (defaults to `fields[0]`). Use `'_root'` for a form-level error. Cross-field rules run after Zod + unique checks.

### Multi-step wizard (backend)

Pass `steps` in the options to split a form into named steps:

```ts
export const onboardingForm = defineForm<OnboardingInsert>(
  [
    text('company_name', { label: 'Company name', required: true }),
    text('nip',          { label: 'NIP' }),
    text('contact_name', { label: 'Contact name', required: true }),
    email('contact_email',{ label: 'Email',       required: true }),
  ],
  {
    steps: [
      { name: 'company',  label: 'Company details', fields: ['company_name', 'nip'] },
      { name: 'contact',  label: 'Contact person',  fields: ['contact_name', 'contact_email'] },
    ],
  },
)
```

Each step is validated individually via `PATCH /submissions/:id/steps/:stepName` — only that step's fields are validated with `'submit'` context. The full form is validated again on `POST /submissions/:id/submit`.

Each form automatically exposes a `GET /:resource/schema` endpoint (see [Schema endpoint](#schema-endpoint) below).

---

## Schema Endpoint

Every registered resource automatically gets a `GET /:resource/schema` endpoint that returns the form field definitions — labels, placeholders, types, required flags — derived directly from the `FormDefinition`.

```bash
GET /users/schema
# → { "ok": true, "data": [
#     { "name": "name",  "label": "Name",  "type": "text",  "required": true },
#     { "name": "email", "label": "Email", "type": "email", "required": true },
#     { "name": "role",  "label": "Role",  "type": "select" },
#     ...
#   ]}
```

The frontend `FormEngine` fetches this schema automatically on init — no hardcoded field configs needed on the frontend.

---

## Frontend Form System

### FormEngine (pure TypeScript)

The engine fetches the form schema from `/:endpoint/schema` on init, then owns submit logic, state machine, and error mapping. No React dependency.

```ts
const engine = new FormEngine<UserInsert>({
  endpoint: '/users',
  onSuccess: (data, mode) => console.log(mode, data), // mode: 'created' | 'updated'
  onError: (errors) => console.error(errors),
  // fields: [...] — optional static override, skips schema fetch
})

engine.load(existingUser)            // pre-populate for edit (auto-switches to PUT /:id)
engine.setValues({ name: 'Jan' })   // merge values + trigger autosave (if configured)
engine.submit(formValues)            // fetch → state machine → notify subscribers
engine.reset()                       // back to idle
```

#### Autosave

Pass `autosave` config to enable debounced PATCH on every `setValues()` call. Requires a loaded `id` (i.e. call `engine.load(existing)` first).

```ts
const engine = new FormEngine<UserInsert>({
  endpoint:  '/users',
  autosave:  { delay: 1500 },   // ms, default 2000
  onSuccess: (data) => console.log('saved', data),
})
engine.load(existingUser)       // sets values.id → autosave will PATCH /:id
```

`FormController` automatically shows "Last saved HH:MM:SS" and a "Saving…" indicator when autosave is active.

### useFormEngine hook

```tsx
function MyForm() {
  const { engine, state, autosaving, lastSaved } = useFormEngine<UserInsert>({
    endpoint: '/users',
    autosave: { delay: 2000 },
    onSuccess: () => navigate('/users'),
  })

  useEffect(() => { engine.load(existingUser) }, [engine])

  return <FormController engine={engine} />
}
```

### WizardEngine (multi-step)

`WizardEngine` manages a multi-step submission form. It fetches steps from the `SubmissionResource`'s `/schema` endpoint, saves each step individually, and submits the whole form at the end.

```tsx
function OnboardingWizard() {
  const { engine, currentStep, steps, isLast } = useWizardEngine<OnboardingInsert>({
    endpoint: '/onboarding',
    onSubmit: (data) => navigate('/done'),
  })

  // Resume an in-progress submission
  useEffect(() => {
    if (existingSubmission) engine.load(existingSubmission)
  }, [engine])

  return <WizardController engine={engine} submitLabel="Submit application" />
}
```

`WizardController` renders only the current step's fields, step indicators, and Prev/Next/Submit buttons. The `engine` is created by `useWizardEngine` — or instantiate `WizardEngine` directly for non-React use.

### Client scripts

```bash
npm run build -w client   # esbuild bundle → client/dist/app.js
npm run dev -w client     # watch mode
```

---

## Available Scripts

Run from the **project root** (npm workspaces):

```bash
npm run dev          # hot reload for both server (tsx watch) and client (esbuild watch)
npm run build        # compile server (tsc) + bundle client (esbuild)
npm run db:generate  # generate Drizzle migrations from schema
npm run db:migrate   # apply migrations
npm run db:studio    # open Drizzle Studio (DB GUI)
```

Or target each package directly:

```bash
npm run dev -w server     # server only
npm run dev -w client     # client only
npm run build -w server
npm run build -w client
```

---

## Testing

```bash
cd server
npm test                  # in-memory tests only (no DB required) — ~19 tests
```

Integration tests require a running Postgres instance:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bff \
JWT_SECRET=any-local-secret \
npm test
```

Or spin up the DB via Docker and run:

```bash
docker-compose up -d db
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bff_db \
JWT_SECRET=any-local-secret \
npm test
```

Without `DATABASE_URL`, integration tests auto-skip (`describe.skipIf`). The in-memory form/workflow tests always run. To run a single test file:

```bash
npx vitest run src/__tests__/user-form.test.ts
```

---

## Advanced Field Types

### Array fields (repeatable rows)

```ts
import { array, text, number } from './core/form/index.js'

array<OrderInsert>('items', {
  label: 'Line items',
  min:   1,
  fields: [
    text<LineItem>('sku',      { label: 'SKU',      required: true }),
    number<LineItem>('qty',    { label: 'Qty',      required: true, min: 1 }),
    number<LineItem>('price',  { label: 'Price',    required: true, min: 0 }),
  ],
  rowRules: [{
    fields:   ['qty', 'price'],
    validate: row => (row.qty as number) * (row.price as number) > 100_000
      ? 'Line total exceeds limit' : null,
  }],
  arrayRules: [rows => rows.length > 50 ? 'Maximum 50 line items' : null],
})
```

### Group fields (namespaced nested object)

Groups produce a single nested object value (`values.address = { street, city, zip }`). Sub-fields validate as a unit.

```ts
import { group, text } from './core/form/index.js'

group<ProfileInsert>('address', {
  label:  'Address',
  fields: [
    text<Address>('street',  { label: 'Street',   required: true }),
    text<Address>('city',    { label: 'City',     required: true }),
    text<Address>('zip',     { label: 'ZIP code' }),
  ],
  rules: [{
    fields:   ['street', 'city'],
    validate: g => !g.street && g.city ? 'Street is required when city is set' : null,
  }],
})
```

Schema endpoint serializes the group as `{ type: 'group', fields: [...] }`.

### Computed fields

Read-only values derived from other fields. Not validated, not saved to the database.

```ts
import { computed, number } from './core/form/index.js'

number<OrderInsert>('price', { label: 'Unit price', required: true }),
number<OrderInsert>('qty',   { label: 'Qty',        required: true }),
computed<OrderInsert>('total', 'Total', v => ((v.price ?? 0) * (v.qty ?? 0)).toFixed(2)),
```

`computed` fields appear in API responses and schema output but are excluded from the Zod schema, unique checks, and payload saving.

### Conditional helpers

`visibleWhen` / `requiredWhen` produce both a runtime callback **and** a serializable JSON rule (`visible_when` / `required_when` in schema output), so the frontend can apply the same logic declaratively:

```ts
import { visibleWhen, requiredWhen, text, select } from './core/form/index.js'

select<LeaveInput>('type', {
  label:   'Leave type',
  options: [{ value: 'sick', label: 'Sick leave' }, { value: 'annual', label: 'Annual' }],
  required: true,
}),
text<LeaveInput>('medical_cert_number', {
  label: 'Medical certificate #',
  ...visibleWhen<LeaveInput>('type', 'eq', 'sick'),
  ...requiredWhen<LeaveInput>('type', 'eq', 'sick'),
}),
```

`visibleWhen` supports operators: `eq`, `neq`, `in`, `notIn`.

### Field-level permissions

`visible` and `editable` accept callbacks that receive `FormContext` (including the authenticated user):

```ts
text<ContractInsert>('salary', {
  label:     'Salary',
  sensitive: true,                                        // redacted as null for unauthorised users
  visible:   ctx => ctx.user?.role === 'hr',              // stripped from response if false
  editable:  ctx => ctx.user?.role === 'hr',              // included but readonly if false
})
```

- `visible: false` — field is removed from API response and Zod schema entirely
- `editable: false` — field appears in response with `readonly: true` in schema; value is ignored in POST/PUT/PATCH payloads
- `sensitive: true` — when invisible, value is returned as `null` instead of being deleted (signals "field exists but you can't see it")

---

## Plugin Validators

Register reusable named validators and attach them to any field with `validators: ['name']`.

```ts
import { validators } from './core/validators/index.js'

// Register a custom validator
validators.register('postal_code_pl', value => {
  if (typeof value !== 'string') return 'Invalid postal code'
  return /^\d{2}-\d{3}$/.test(value) ? null : 'Must match format 00-000'
})

// Use on a field
text<AddressInsert>('zip', {
  label:      'ZIP code',
  validators: ['postal_code_pl'],
})
```

Named validators run after Zod + unique checks + cross-field rules but before async validators. Both sync and async functions are supported.

### Built-in validators

The following are registered automatically when you import from `core/validators/index.js`:

| Name | Description |
|---|---|
| `nip` | Polish tax ID (NIP) — 10-digit checksum |
| `regon` | Polish business registry (REGON) — 9 or 14-digit checksum |
| `pesel` | Polish personal ID (PESEL) — 11-digit checksum |
| `iban` | International bank account number — mod-97 checksum |
| `phone_pl` | Polish phone number — `+48XXXXXXXXX` / `0048XXXXXXXXX` / 9 digits |

---

## Bulk Operations

`POST /:resource/bulk` accepts an array of up to 100 create / update / delete operations executed all-or-nothing:

```bash
POST /users/bulk
{
  "operations": [
    { "op": "create", "data": { "name": "Jan Kowalski", "email": "jan@example.com" } },
    { "op": "update", "id": 5, "data": { "role": "admin" } },
    { "op": "delete", "id": 12 }
  ]
}
```

All operations are validated before any are executed. If any operation fails validation the entire batch is rejected with a 422.

---

## Nested Resources

Register a resource under a parent path — the framework automatically filters by parent ID and validates parent existence:

```ts
// server/src/resources/posts/resource.ts
export class PostsResource extends BaseCrud<typeof posts, PostInsert, Post> {
  readonly model       = new PostModel()
  readonly form        = postForm
  readonly parentField = 'user_id'   // FK column to inject
}

// server/src/index.ts
registry
  .register('users', UsersResource)
  .register('users/:userId/posts', PostsResource)
  .mount(app)
```

This gives you `GET /users/3/posts` (returns only posts for user 3), `POST /users/3/posts` (injects `user_id: 3` before validation), etc. Override `parentExists()` to add custom parent validation logic.

---

## Response Shaping

Append `?fields=` to any list or detail endpoint to receive only the specified columns:

```bash
GET /users?fields=id,name,role
# → [{ "id": 1, "name": "Jan Kowalski", "role": "admin" }, ...]

GET /users/1?fields=id,name
# → { "id": 1, "name": "Jan Kowalski" }
```

---

## Dynamic Schema Evaluation

`POST /:resource/schema/evaluate` returns the form schema computed against a specific set of values — useful for driving conditional visibility on the frontend without custom endpoints:

```bash
POST /leave-requests/schema/evaluate
{ "values": { "type": "sick" } }
# → schema with medical_cert_number marked visible + required
```

---

## Filter Operators (complete list)

| Operator | Meaning |
|---|---|
| *(none / default)* | `eq` — exact match |
| `eq` | exact match |
| `neq` | not equal |
| `like` | `LIKE %value%` |
| `in` | column IN (comma-separated values) |
| `gt` / `gte` | greater than / greater or equal |
| `lt` / `lte` | less than / less or equal |
| `isNull` | column IS NULL (value ignored) |

```bash
GET /users?filter[role][neq]=admin
GET /users?filter[role][in]=admin,manager
```

Fields must have `filterable: true` on their field definition to be accepted; unknown fields are silently ignored.

---

## Audit Log

Every `BaseCrud` create / update / delete and every workflow transition is automatically logged when `auditLogger` is set on the resource. Read the log via the built-in endpoints:

```bash
GET /audit                                     # all events, paginated
GET /audit?entity=users&action=update          # filtered
GET /audit?userId=5&from=2025-01-01&to=2025-06-01 # date range
GET /audit/users/42                            # all events for a specific record
```

Query params: `entity`, `entityId`, `action`, `userId`, `from`, `to`, `page`, `pageSize`.

Each event: `{ id, entity_type, entity_id, action, user_id, payload, timestamp }`.

---

## Workflow Engine — Advanced

### State timeouts (4.6)

Attach a TTL to any state. `WorkflowScheduler` polls the database and fires the `onTimeout` transition automatically:

```ts
import { defineWorkflow, WorkflowScheduler } from './core/workflow/index.js'

const reviewWorkflow = defineWorkflow({
  name: 'review',
  initial: 'pending',
  states: [
    { name: 'pending', type: 'initial' },
    {
      name:      'under_review',
      type:      'intermediate',
      ttl:       48 * 3600,          // 48 hours in seconds
      onTimeout: 'escalate',         // transition name to fire on expiry
    },
    { name: 'escalated', type: 'intermediate' },
    { name: 'approved',  type: 'final' },
  ],
  transitions: [
    { name: 'start',    from: 'pending',      to: 'under_review' },
    { name: 'escalate', from: 'under_review', to: 'escalated' },
    { name: 'approve',  from: ['under_review', 'escalated'], to: 'approved' },
  ],
})

// Start the scheduler (e.g. in index.ts)
new WorkflowScheduler(reviewWorkflow, 'review_request').start(60_000) // check every minute
```

`workflow_state_entered_at` is recorded automatically on every workflow state change.

### Parallel branches (4.7)

States can fan out into multiple independent approval branches. The merge fires automatically when the configured condition (`'all'` or `'any'`) is met:

```ts
{
  name:            'awaiting_approvals',
  type:            'intermediate',
  mergeWhen:       'all',                // 'all' branches final → merge
  mergeTransition: 'complete',           // transition to fire on merge
  branches: [
    {
      name:    'manager',
      initial: 'pending',
      states:  [
        { name: 'pending',  type: 'initial' },
        { name: 'approved', type: 'final'   },
        { name: 'rejected', type: 'final'   },
      ],
      transitions: [
        { name: 'approve', from: 'pending', to: 'approved' },
        { name: 'reject',  from: 'pending', to: 'rejected' },
      ],
    },
    {
      name:    'legal',
      initial: 'pending',
      states:  [/* same shape */],
      transitions: [/* same shape */],
    },
  ],
},
```

Branch transition endpoints (added automatically by `SubmissionResource`):

```bash
GET  /submissions/:id/branches/:branch/transitions         # available transitions
POST /submissions/:id/branches/:branch/transitions/:action # fire a branch transition
```

Branch states are stored as `workflow_branches: { manager: 'pending', legal: 'approved' }` on the submission. When the merge fires, the main workflow state advances and branch states reset.

### Workflow visualization (4.8)

```bash
GET /workflows                    # list registered workflow names
GET /workflows/:name/graph        # full state/transition graph (guards stripped)
```

The graph response is ready for frontend diagram rendering (states as nodes, transitions as edges). Branch definitions are included in states that define them.

```ts
const graph = leaveWorkflow.toGraph()
// {
//   states:      [{ name, type, label?, ttl?, branches? }, ...],
//   transitions: [{ name, from, to, label? }, ...],
// }
```

---

## Workflow Submission Endpoints (complete list)

When `SubmissionResource` has a `workflow` attached, these endpoints are available in addition to the standard CRUD:

| Method | Path | Description |
|---|---|---|
| `GET` | `/:id/transitions` | Available transitions for current user |
| `POST` | `/:id/transitions/:action` | Execute a workflow transition |
| `GET` | `/:id/branches/:branch/transitions` | Available branch transitions |
| `POST` | `/:id/branches/:branch/transitions/:action` | Execute a branch transition |
| `POST` | `/:id/assign` | Manually set `assigned_to` |
| `PATCH` | `/:id/steps/:step` | Save data for a wizard step |
| `GET` | `/:id/history` | Full version history |
| `GET` | `/:id/history/:version` | Snapshot at a specific version |

---

## Testing Utilities

All testing helpers are exported from `server/src/core/testing/index.ts`.

### FormTestKit — sync form validation assertions

```ts
import { FormTestKit } from '../core/testing/index.js'

FormTestKit.fill(userForm, { name: '', email: 'not-an-email' })
  .expectInvalid()
  .expectError('email', 'email')
  .expectNoError('name')

FormTestKit.fill(userForm, { name: 'Jan', email: 'jan@test.pl' })
  .withContext({ user: { id: 1, role: 'admin' } })
  .expectValid()
  .expectFieldVisible('salary')   // only visible for admins
```

### WorkflowTestKit — workflow transition assertions

```ts
import { WorkflowTestKit } from '../core/testing/index.js'

const wf = WorkflowTestKit.start(leaveWorkflow)

await wf.inState('submitted').as({ id: 1, role: 'manager' })
  .transition('approve')
  .then(r => r.toSucceed().toBeInState('approved'))

await wf.inState('submitted').as({ id: 2, role: 'employee' })
  .transition('approve')
  .then(r => r.toFail().toFailWithReason('guard_failed'))
```

### IntegrationTestKit — real-database testing

```ts
import { seed, testDb, TestClient } from '../core/testing/index.js'
import { app } from '../index.js'

const client = new TestClient(app)

beforeEach(() => testDb.truncateAll())

test('POST /users requires auth', async () => {
  const { res } = await client.post('/users').send({ name: 'Jan', email: 'jan@example.com' }).json()
  expect(res.status).toBe(401)
})

test('admin can create a user', async () => {
  const admin = await seed.createUser({ role: 'admin' })
  const { res, body } = await client.post('/users')
    .withAuth(admin).send({ name: 'Jan', email: 'jan@example.com' }).json()
  expect(res.status).toBe(201)
  expect(body.data.name).toBe('Jan')
})
```

`seed` helpers: `createUser({ role })`, `createSubmission(opts)`.
`testDb.truncate('users', 'audit_events')` for targeted cleanup.

### Schema snapshot testing

```ts
import { schemaSnapshot, graphSnapshot, diffSchemaSnapshots } from '../core/testing/index.js'

// Detect unintended schema regressions
expect(schemaSnapshot(userForm)).toMatchSnapshot()
expect(graphSnapshot(reviewWorkflow)).toMatchSnapshot()

// Compare two schema versions programmatically
const diff = diffSchemaSnapshots(oldSnapshot, newSnapshot)
// → { added: ['phone'], removed: [], changed: ['email'] }
```
