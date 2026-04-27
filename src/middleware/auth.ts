import type { MiddlewareHandler } from 'hono'
import { fail } from '../core/routing/index.js'

/**
 * Stub JWT auth middleware — swap with your real implementation.
 * Attach decoded user to ctx.set('user', ...) for use in resources.
 */
export const authMiddleware: MiddlewareHandler = async (ctx, next) => {
  const header = ctx.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return ctx.json(fail({ _root: ['Unauthorized'] }), 401)
  }
  // TODO: verify JWT, decode payload, ctx.set('user', payload)
  await next()
}
