import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { ResourceRegistry } from './core/routing/index.js'
import { WorkflowRegistry } from './core/workflow/index.js'
import { mountAuditRoutes } from './core/audit/index.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authMiddleware } from './middleware/auth.js'
import { UsersResource } from './resources/users/resource.js'
import { db } from './db/index.js'
import { sql } from 'drizzle-orm'

export const app = new Hono()

app.use('*', logger())
app.onError(errorHandler)

app.use('/static/*', serveStatic({ root: '../client/dist', rewriteRequestPath: p => p.replace('/static', '') }))

// Health check — includes DB liveness
app.get('/health', async ctx => {
  try {
    await db.execute(sql`SELECT 1`)
    return ctx.json({ ok: true })
  } catch {
    return ctx.json({ ok: false, error: 'Database unavailable' }, 503)
  }
})

// All other routes require a valid JWT
app.use('*', authMiddleware)

// Register resources — add yours here; markers used by `npm run generate resource`; do not remove
// <!-- generate:resources -->
const registry = new ResourceRegistry()
registry
  // <!-- generate:registry -->
  .register('users', UsersResource)
  .mount(app)

// Workflow graph endpoints — register workflows here
const workflows = new WorkflowRegistry()
// workflows.register(leaveWorkflow)
workflows.mount(app)

// Audit log read API
mountAuditRoutes(app)
