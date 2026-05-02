/**
 * Example: integration tests using TestClient + seed helpers.
 *
 * These tests hit a REAL PostgreSQL database.
 * Requires DATABASE_URL and JWT_SECRET in the environment.
 *
 * Run with Docker:
 *   docker-compose up -d db
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/bff \
 *   JWT_SECRET=test-secret \
 *   npm test
 *
 * Or run inside Docker: docker-compose exec app npm test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { app } from '../app.js'
import { seed, testDb, TestClient, createTestToken } from '../core/testing/index.js'

// Skip entire suite if no DB configured — keeps CI green without Postgres
const hasDatabaseUrl = Boolean(process.env['DATABASE_URL'])

describe.skipIf(!hasDatabaseUrl)('Users API — integration', () => {
  const client = new TestClient(app)

  beforeEach(async () => {
    await testDb.truncateAll()
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('GET /users returns 401 without token', async () => {
    const res = await client.get('/users').fetch()
    expect(res.status).toBe(401)
  })

  it('GET /users returns 401 with bad token', async () => {
    const res = await client.get('/users').header('Authorization', 'Bearer bad').fetch()
    expect(res.status).toBe(401)
  })

  // ── CRUD ──────────────────────────────────────────────────────────────────

  it('GET /users returns empty list', async () => {
    const user = await createTestToken({ role: 'admin' })
    const { res, body } = await client.get('/users').withAuth(user).json<any>()
    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(0)
    expect(body.meta.total).toBe(0)
  })

  it('POST /users creates a user', async () => {
    const admin = await createTestToken({ role: 'admin' })
    const { res, body } = await client.post('/users').withAuth(admin).send({
      email:  'bob@example.com',
      name:   'Bob',
      role:   'user',
      active: true,
    }).json<any>()
    expect(res.status).toBe(201)
    expect(body.data.email).toBe('bob@example.com')
    expect(body.data.id).toBeTypeOf('number')
  })

  it('POST /users returns 422 for invalid email', async () => {
    const admin = await createTestToken({ role: 'admin' })
    const { res, body } = await client.post('/users').withAuth(admin).send({
      email: 'not-an-email',
      name:  'Bob',
      role:  'user',
    }).json<any>()
    expect(res.status).toBe(422)
    expect(body.errors.email).toBeDefined()
  })

  it('GET /users/:id returns 404 for missing user', async () => {
    const admin = await createTestToken({ role: 'admin' })
    const res = await client.get('/users/9999').withAuth(admin).fetch()
    expect(res.status).toBe(404)
  })

  it('full CRUD cycle', async () => {
    const admin = await createTestToken({ role: 'admin' })

    // create
    const { body: created } = await client.post('/users').withAuth(admin).send({
      email: 'alice@example.com', name: 'Alice', role: 'user', active: true,
    }).json<any>()
    const id = created.data.id

    // read
    const { body: fetched } = await client.get(`/users/${id}`).withAuth(admin).json<any>()
    expect(fetched.data.name).toBe('Alice')

    // update
    const { body: updated } = await client.put(`/users/${id}`).withAuth(admin).send({
      email: 'alice@example.com', name: 'Alice Updated', role: 'manager', active: true,
    }).json<any>()
    expect(updated.data.name).toBe('Alice Updated')

    // delete
    const del = await client.delete(`/users/${id}`).withAuth(admin).fetch()
    expect(del.status).toBe(204)

    // confirm gone
    const notFound = await client.get(`/users/${id}`).withAuth(admin).fetch()
    expect(notFound.status).toBe(404)
  })

  // ── Seeding ───────────────────────────────────────────────────────────────

  it('seed.createUser inserts into DB', async () => {
    await seed.createUser({ email: 'seeded@example.com', name: 'Seeded', role: 'user' })
    const admin = await createTestToken({ role: 'admin' })
    const { body } = await client.get('/users').withAuth(admin).json<any>()
    expect(body.meta.total).toBe(1)
  })
})
