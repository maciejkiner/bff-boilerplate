import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { ResourceRegistry } from './core/routing/index.js'
import { WorkflowRegistry } from './core/workflow/index.js'
import { mountAuditRoutes } from './core/audit/index.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authMiddleware } from './middleware/auth.js'
import { CompaniesResource } from './resources/companies/resource.js'

const app = new Hono()

app.use('*', logger())
app.onError(errorHandler)

app.use('/static/*', serveStatic({ root: '../client/dist', rewriteRequestPath: p => p.replace('/static', '') }))

// Health check — public
app.get('/health', ctx => ctx.json({ ok: true }))

// All other routes require a valid JWT
app.use('*', authMiddleware)

// Register resources — each auto-wires GET/POST/PUT/DELETE routes
const registry = new ResourceRegistry()
registry
  .register('companies', CompaniesResource)
  // .register('users', UsersResource)
  .mount(app)

// Workflow graph endpoints — register workflows here
const workflows = new WorkflowRegistry()
// workflows.register(leaveWorkflow)
workflows.mount(app)

// Audit log read API
mountAuditRoutes(app)

const port = Number(process.env['PORT'] ?? 3000)
console.log(`Server running on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
