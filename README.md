# BFF Boilerplate

A lightweight TypeScript Backend-for-Frontend framework built around three core primitives: **fluent form handling**, **CRUD resources**, and **a thin model layer**. Inspired by a PHP framework built for ROPA/company management, redesigned for modern TypeScript.

---

## Tech Stack

| Layer | Library |
|---|---|
| HTTP / Routing | [Hono](https://hono.dev) |
| Database ORM | [Drizzle](https://orm.drizzle.team) |
| Validation | [Zod](https://zod.dev) |
| Runtime | Node.js 22 |
| Language | TypeScript 5 (strict) |
| Database | PostgreSQL 16 |

---

## Architecture

```
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
# generate SQL from schema
docker-compose exec app npm run db:generate

# apply to database
docker-compose exec app npm run db:migrate
```

### 4. Health check

```bash
curl http://localhost:3000/health
# → { "ok": true }
```

---

## Adding a New Resource

### 1. Add a table to `src/db/schema.ts`

```ts
export const users = pgTable('users', {
  id:         serial('id').primaryKey(),
  email:      varchar('email', { length: 200 }).notNull().unique(),
  name:       varchar('name',  { length: 100 }).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})
```

### 2. Create `src/resources/users/model.ts`

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

### 3. Create `src/resources/users/form.ts`

```ts
import { FormBuilder } from '../../core/form/index.js'
import type { UserInsert } from './model.js'

export const userForm = new FormBuilder<UserInsert>()
  .field('name').required().maxLength(100)
  .field('email').required().isEmail().isUnique('users', 'email')
  .build()
```

### 4. Create `src/resources/users/resource.ts`

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

### 5. Register in `src/index.ts`

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

## Available Scripts

```bash
npm run dev          # tsx watch — hot reload (outside Docker)
npm run build        # tsc compile to dist/
npm run db:generate  # generate Drizzle migrations from schema
npm run db:migrate   # apply migrations
npm run db:studio    # open Drizzle Studio (DB GUI)
```
