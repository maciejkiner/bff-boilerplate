import { verify } from 'hono/jwt'
import type { MiddlewareHandler } from 'hono'
import { fail } from '../core/routing/index.js'

export interface AuthUser {
  id:   number
  role: string
}

export const authMiddleware: MiddlewareHandler = async (ctx, next) => {
  const header = ctx.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return ctx.json(fail({ _root: ['Unauthorized'] }), 401)
  }
  try {
    const payload = await verify(header.slice(7), process.env['JWT_SECRET'] ?? 'change-me', 'HS256')
    ctx.set('user', { id: payload['id'] as number, role: payload['role'] as string } satisfies AuthUser)
  } catch {
    return ctx.json(fail({ _root: ['Invalid token'] }), 401)
  }
  await next()
}
