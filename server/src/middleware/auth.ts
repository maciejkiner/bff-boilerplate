import { verify } from 'hono/jwt'
import type { MiddlewareHandler } from 'hono'
import { fail } from '../core/routing/index.js'

export interface AuthUser {
  id:   number
  role: string
}

export function validateJwtSecret(): void {
  const secret = process.env['JWT_SECRET']
  if (!secret || secret === 'change-me') {
    console.error('FATAL: JWT_SECRET is not set or is the default placeholder. Set a strong secret in your .env file.')
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
    process.exit(1)
  }
}

export const authMiddleware: MiddlewareHandler = async (ctx, next) => {
  const header = ctx.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return ctx.json(fail({ _root: ['Unauthorized'] }), 401)
  }
  const secret = process.env['JWT_SECRET'] ?? 'change-me'
  try {
    const payload = await verify(header.slice(7), secret, 'HS256')
    ctx.set('user', { id: payload['id'] as number, role: payload['role'] as string } satisfies AuthUser)
  } catch {
    return ctx.json(fail({ _root: ['Invalid token'] }), 401)
  }
  await next()
}
