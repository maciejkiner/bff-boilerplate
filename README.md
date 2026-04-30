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
POST /companies
  → Hono router
  → CompaniesResource.create()        (inherits from BaseCrud)
  → handleForm(companyForm, model, body)
      → Zod validation
      → unique constraint checks
      → model.save(data)
  → { ok: true, data: Company }
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
# edit DATABASE_URL, JWT_SECRET if needed
```

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

Shows a companies form in edit mode (pre-populated). Comment out the `engine.load()` call in `client/src/index.tsx` to test create mode.

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
  .register('companies', CompaniesResource)
  .register('users', UsersResource)   // ← add this
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
PATCH /companies/1
{ "city": "Kraków" }
# validates only the 'city' field, updates only that column
```

---

## Filtering, Sorting & Pagination

All `GET /:resource` list endpoints support filtering, sorting, and offset-based pagination via query parameters — no extra code required.

### Filtering

```
GET /companies?filter[name][like]=acme
GET /companies?filter[city]=Warsaw&filter[name][like]=tech
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
GET /companies?sort=name           # ascending
GET /companies?sort=-createdAt     # descending
GET /companies?sort=-createdAt,name  # multiple
```

### Pagination

```
GET /companies?page=2&pageSize=10
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
export class CompaniesResource extends BaseCrud<typeof companies, CompanyInsert, Company> {
  readonly model = new CompanyModel()
  readonly form  = companyForm

  // Scope list to current user's tenant
  protected override async beforeList(query: ListQuery, ctx: Context) {
    const tenantId = ctx.get('tenantId') as string
    return { ...query, filters: [...query.filters, { field: 'tenant_id', op: 'eq' as const, value: tenantId }] }
  }

  // Inject createdBy before validation
  protected override async beforeCreate(body: unknown, ctx: Context) {
    const user = ctx.get('user') as { id: number }
    return { ...(body as object), created_by: user.id }
  }

  // Send notification after a record is created
  protected override async afterCreate(record: Company, _ctx: Context) {
    await notify(`New company created: ${record.name}`)
  }

  // Prevent deletion of locked records
  protected override async beforeDelete(id: number, _ctx: Context) {
    const row = await this.model.get(id)
    if (row?.locked) throw new Error('Cannot delete a locked company')
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
GET /companies/schema
# → { "ok": true, "data": [
#     { "name": "name",     "label": "Company name", "type": "text",  "required": true },
#     { "name": "nip",      "label": "NIP",          "type": "text",  "placeholder": "000-000-00-00" },
#     { "name": "city",     "label": "City",         "type": "text" },
#     ...
#   ]}
```

The frontend `FormEngine` fetches this schema automatically on init — no hardcoded field configs needed on the frontend.

---

## Frontend Form System

### FormEngine (pure TypeScript)

The engine fetches the form schema from `/:endpoint/schema` on init, then owns submit logic, state machine, and error mapping. No React dependency.

```ts
const engine = new FormEngine<CompanyInsert>({
  endpoint: '/companies',
  onSuccess: (data, mode) => console.log(mode, data), // mode: 'created' | 'updated'
  onError: (errors) => console.error(errors),
  // fields: [...] — optional static override, skips schema fetch
})

engine.load(existingCompany)         // pre-populate for edit (auto-switches to PUT /:id)
engine.setValues({ name: 'Acme' })  // merge values + trigger autosave (if configured)
engine.submit(formValues)            // fetch → state machine → notify subscribers
engine.reset()                       // back to idle
```

#### Autosave

Pass `autosave` config to enable debounced PATCH on every `setValues()` call. Requires a loaded `id` (i.e. call `engine.load(existing)` first).

```ts
const engine = new FormEngine<CompanyInsert>({
  endpoint:  '/companies',
  autosave:  { delay: 1500 },   // ms, default 2000
  onSuccess: (data) => console.log('saved', data),
})
engine.load(existingCompany)    // sets values.id → autosave will PATCH /:id
```

`FormController` automatically shows "Last saved HH:MM:SS" and a "Saving…" indicator when autosave is active.

### useFormEngine hook

```tsx
function MyForm() {
  const { engine, state, autosaving, lastSaved } = useFormEngine<CompanyInsert>({
    endpoint: '/companies',
    autosave: { delay: 2000 },
    onSuccess: () => navigate('/companies'),
  })

  useEffect(() => { engine.load(existingCompany) }, [engine])

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
