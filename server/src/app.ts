import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { rateLimiter } from 'hono-rate-limiter'
import { ResourceRegistry } from './core/routing/index.js'
import { WorkflowRegistry } from './core/workflow/index.js'
import { mountAuditRoutes } from './core/audit/index.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authMiddleware } from './middleware/auth.js'
import { requestLogger } from './middleware/requestLogger.js'
import { UsersResource } from './resources/users/resource.js'
import { config } from './config.js'
import { generateOpenApiSpec, swaggerUiHtml } from './core/openapi/generate.js'
import { db } from './db/index.js'
import { sql } from 'drizzle-orm'
import { mountAuthRoutes } from './resources/auth/authRoutes.js'

export const app = new Hono()

app.onError(errorHandler)
app.use('*', requestLogger)

// CORS — before auth so preflight OPTIONS requests pass through
app.use('*', cors({
  origin:      config.NODE_ENV === 'production'
                 ? config.ALLOWED_ORIGINS!.split(',').map(s => s.trim())
                 : '*',
  credentials: true,
}))

// Body size cap
app.use('*', bodyLimit({
  maxSize: config.MAX_BODY_SIZE_KB * 1024,
  onError: (c) => c.json({ ok: false, errors: { _root: [`Request body exceeds ${config.MAX_BODY_SIZE_KB} KB limit`] } }, 413),
}))

// Rate limiting
app.use('*', rateLimiter({
  windowMs:     config.RATE_LIMIT_WINDOW_MS,
  limit:        config.RATE_LIMIT_MAX,
  keyGenerator: (c) => c.req.header('x-forwarded-for') ?? 'unknown',
  handler:      (c) => c.json({ ok: false, errors: { _root: ['Too many requests'] } }, 429),
}))

// Security headers in production
app.use('*', async (ctx, next) => {
  await next()
  if (config.NODE_ENV === 'production') {
    ctx.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    ctx.header('X-Content-Type-Options', 'nosniff')
    ctx.header('X-Frame-Options', 'DENY')
  }
})

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

// Public auth routes — must come before global authMiddleware
mountAuthRoutes(app)

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

// OpenAPI spec and Swagger UI (dev only for UI)
app.get('/openapi.json', ctx => ctx.json(generateOpenApiSpec(registry, 'BFF API', '1.0.0')))
if (config.NODE_ENV !== 'production') {
  app.get('/docs', ctx => ctx.html(swaggerUiHtml('/openapi.json')))

  // Basic process metrics for development introspection
  app.get('/metrics', ctx => ctx.json({
    uptime:  process.uptime(),
    memory:  process.memoryUsage(),
    node:    process.version,
    env:     config.NODE_ENV,
  }))
}
