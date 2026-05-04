import { createMiddleware } from 'hono/factory'
import { randomUUID }       from 'node:crypto'
import { logger }           from '../lib/logger.js'
import type { AuthUser }    from './auth.js'

export const requestLogger = createMiddleware(async (ctx, next) => {
  const requestId = randomUUID()
  const start     = Date.now()
  ctx.set('requestId', requestId)

  await next()

  const user = ctx.get('user') as AuthUser | undefined
  logger.info({
    requestId,
    userId:     user?.id,
    method:     ctx.req.method,
    path:       ctx.req.path,
    status:     ctx.res.status,
    durationMs: Date.now() - start,
  })
})
