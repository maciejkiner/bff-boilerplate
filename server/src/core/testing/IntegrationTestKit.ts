import { sign } from 'hono/jwt'
import { sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import { db } from '../../db/index.js'
import { users, form_submissions } from '../../db/schema.js'

// ── Test users ────────────────────────────────────────────────────────────────

export interface TestUser {
  id:    number
  role:  string
  token: string
}

let _userIdCounter = 1000

/** Creates a JWT token without a DB row — for auth-only test scenarios. */
export async function createTestToken(opts: { id?: number; role?: string } = {}): Promise<TestUser> {
  const id     = opts.id   ?? _userIdCounter++
  const role   = opts.role ?? 'user'
  const secret = process.env['JWT_SECRET'] ?? 'change-me'
  const token  = await sign({ id, role }, secret, 'HS256')
  return { id, role, token }
}

export const seed = {
  async createUser(opts: Partial<typeof users.$inferInsert> = {}) {
    const [row] = await db
      .insert(users)
      .values({
        email: opts.email ?? `user${Date.now()}@example.com`,
        name:  opts.name  ?? 'Test User',
        role:  opts.role  ?? 'user',
        ...opts,
      })
      .returning()
    return row!
  },

  async createSubmission(opts: Partial<typeof form_submissions.$inferInsert> = {}) {
    const [row] = await db
      .insert(form_submissions)
      .values({
        form_name:      opts.form_name      ?? 'test',
        status:         opts.status         ?? 'draft',
        data:           opts.data           ?? {},
        created_by:     opts.created_by     ?? null,
        assigned_to:    opts.assigned_to    ?? null,
        current_step:   opts.current_step   ?? null,
        workflow_state: opts.workflow_state ?? null,
      })
      .returning()
    return row!
  },
}

// ── TestDb — table cleanup ────────────────────────────────────────────────────

type KnownTable = 'users' | 'form_submissions' | 'form_submission_versions' | 'audit_events'

const TABLE_ORDER: KnownTable[] = [
  'audit_events',
  'form_submission_versions',
  'form_submissions',
  'users',
]

export class TestDb {
  async truncateAll(): Promise<void> {
    await db.execute(
      sql`TRUNCATE TABLE audit_events, form_submission_versions, form_submissions, users RESTART IDENTITY CASCADE`
    )
    _userIdCounter = 1000
  }

  async truncate(...tables: KnownTable[]): Promise<void> {
    const ordered = TABLE_ORDER.filter(t => tables.includes(t))
    for (const table of ordered) {
      await db.execute(sql`TRUNCATE TABLE ${sql.identifier(table)} RESTART IDENTITY CASCADE`)
    }
  }
}

export const testDb = new TestDb()

// ── TestClient — Hono app request builder ─────────────────────────────────────

class RequestBuilder {
  private _token?:   string
  private _body?:    unknown
  private _headers:  Record<string, string> = {}

  constructor(
    private readonly app:    Hono,
    private readonly method: string,
    private readonly path:   string,
  ) {}

  withAuth(user: { token: string }): this {
    this._token = user.token
    return this
  }

  send(body: unknown): this {
    this._body = body
    return this
  }

  header(name: string, value: string): this {
    this._headers[name] = value
    return this
  }

  async fetch(): Promise<Response> {
    const headers: Record<string, string> = { ...this._headers }
    if (this._token)           headers['Authorization'] = `Bearer ${this._token}`
    if (this._body !== undefined) headers['Content-Type'] = 'application/json'
    return this.app.fetch(
      new Request(`http://localhost${this.path}`, {
        method:  this.method,
        headers,
        ...(this._body !== undefined ? { body: JSON.stringify(this._body) } : {}),
      }),
    )
  }

  async json<T = unknown>(): Promise<{ res: Response; body: T }> {
    const res  = await this.fetch()
    const body = await res.json() as T
    return { res, body }
  }
}

export class TestClient {
  constructor(private readonly app: Hono) {}

  get   (path: string): RequestBuilder { return new RequestBuilder(this.app, 'GET',    path) }
  post  (path: string): RequestBuilder { return new RequestBuilder(this.app, 'POST',   path) }
  put   (path: string): RequestBuilder { return new RequestBuilder(this.app, 'PUT',    path) }
  patch (path: string): RequestBuilder { return new RequestBuilder(this.app, 'PATCH',  path) }
  delete(path: string): RequestBuilder { return new RequestBuilder(this.app, 'DELETE', path) }
}
