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
{ "ok": false, "errors": { "field": ["message"] } }
```

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
DELETE /users/:id
```

---

## Overriding Default Handlers

Override any method in your resource class:

```ts
export class UsersResource extends BaseCrud<typeof users, UserInsert, User> {
  readonly model = new UserModel()
  readonly form  = userForm

  // Custom list with pagination
  override async list(ctx: Context): Promise<Response> {
    const page  = Number(ctx.req.query('page') ?? 1)
    const limit = 20
    const rows  = await this.model.paginate(page, limit)
    return ctx.json(ok(rows))
  }
}
```

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

Rules that span multiple fields are passed as the second argument to `defineForm`. Each rule receives the validated values and `FormContext`, returns an error string or `null`:

```ts
import { defineForm, text, number } from '../../core/form/index.js'

export const eventForm = defineForm<EventInsert>(
  [
    text('title',    { label: 'Title',      required: true }),
    text('startDate',{ label: 'Start date', required: true }),
    text('endDate',  { label: 'End date',   required: true }),
    number('budget', { label: 'Budget' }),
    number('spent',  { label: 'Spent' }),
  ],
  [
    {
      fields:     ['startDate', 'endDate'],
      errorField: 'endDate',
      validate:   (v) => v.endDate && v.startDate && v.endDate < v.startDate
                    ? 'End date must be after start date'
                    : null,
    },
    {
      fields:     ['budget', 'spent'],
      errorField: 'spent',
      validate:   (v) => v.spent !== undefined && v.budget !== undefined && v.spent > v.budget
                    ? 'Spent cannot exceed budget'
                    : null,
    },
  ],
)
```

Errors are attached to `errorField` (defaults to `fields[0]`). Use `'_root'` for a form-level error not tied to any field. Cross-field rules run **after** Zod field validation and unique checks — they only execute when per-field validation already passes.

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

engine.load(existingCompany)   // pre-populate for edit (auto-switches to PUT /:id)
engine.submit(formValues)      // fetch → state machine → notify subscribers
engine.reset()                 // back to idle
```

### useFormEngine hook

```tsx
function MyForm() {
  const { engine, state } = useFormEngine<CompanyInsert>({
    endpoint: '/companies',
    onSuccess: () => navigate('/companies'),
  })

  // pre-populate for edit
  useEffect(() => { engine.load(existingCompany) }, [engine])

  // FormController fetches schema automatically — no fields prop needed
  return <FormController engine={engine} />
}
```

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
