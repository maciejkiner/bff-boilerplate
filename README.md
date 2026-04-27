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
import { FormBuilder } from '../../core/form/index.js'
import type { UserInsert } from './model.js'

export const userForm = new FormBuilder<UserInsert>()
  .field('name').required().maxLength(100)
  .field('email').required().isEmail().isUnique('users', 'email')
  .build()
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

## FormBuilder API

```ts
new FormBuilder<MyInput>()
  .field('name').required().maxLength(100)
  .field('email').required().isEmail().isUnique('table', 'column')
  .field('age').isNumber().min(0).max(120)
  .field('role').isEnum(['admin', 'user'])
  .field('website').optional().isUrl()
  .field('bio').optional().maxLength(500)
  .build()
```

---

## Frontend Form System

### FormEngine (pure TypeScript)

The engine owns all logic and has no React dependency — it can be used headlessly or wrapped by any other framework.

```ts
const engine = new FormEngine<CompanyInsert>({
  endpoint: '/companies',
  onSuccess: (data, mode) => console.log(mode, data), // mode: 'created' | 'updated'
  onError: (errors) => console.error(errors),
})

engine.load(existingCompany)   // pre-populate for edit (auto-switches to PUT /:id)
engine.submit(formValues)      // fetch → state machine → notify subscribers
engine.reset()                 // back to idle
```

### useFormEngine hook

```tsx
function MyForm() {
  const { engine, state, errors, isSubmitting } = useFormEngine<CompanyInsert>({
    endpoint: '/companies',
    onSuccess: () => navigate('/companies'),
  })

  // pre-populate for edit
  useEffect(() => { engine.load(existingCompany) }, [engine])

  return <FormController fields={companyFields} engine={engine} />
}
```

### FieldConfig types

```ts
type FieldType = 'text' | 'email' | 'url' | 'number' | 'boolean' | 'select' | 'textarea'

interface FieldConfig {
  name: string
  label: string
  type: FieldType
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[]  // for select
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
