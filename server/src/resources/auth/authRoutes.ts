import { Hono } from 'hono'
import { hash } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/index.js'
import { users, user_credentials } from '../../db/schema.js'
import { ok, fail } from '../../core/routing/index.js'
import { LocalAuthProvider } from '../../core/auth/providers/LocalAuthProvider.js'
import { createAuthMiddleware } from '../../core/auth/createAuthMiddleware.js'
import { JwtAuthProvider } from '../../core/auth/providers/JwtAuthProvider.js'
import {
  issueTokenPair,
  revokeJti,
  revokeRefreshToken,
  revokeAllUserTokens,
  refreshAccessToken,
} from '../../core/auth/issueTokens.js'
import { config } from '../../config.js'
import type { AuthUser } from '../../core/auth/AuthProvider.js'

const registerSchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role:     z.string().optional(),
})

const changePasswordSchema = z.object({
  current_password: z.string(),
  new_password:     z.string().min(8),
})

const jwtMiddleware = createAuthMiddleware(new JwtAuthProvider(config))

export function mountAuthRoutes(app: Hono): void {
  // ── Public routes (no auth required) ─────────────────────────────────────────

  /** POST /auth/register */
  app.post('/auth/register', async ctx => {
    const body = await ctx.req.json().catch(() => null)
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return ctx.json(fail(parsed.error.flatten().fieldErrors as Record<string, string[]>), 422)
    }
    const { email, name, password, role } = parsed.data

    const existing = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) })
    if (existing) return ctx.json(fail({ email: ['Email already registered'] }), 409)

    const [user] = await db.insert(users)
      .values({ email: email.toLowerCase(), name, role: role ?? 'user' })
      .returning()

    const password_hash = await hash(password, 12)
    await db.insert(user_credentials).values({ user_id: user!.id, password_hash })

    const tokens = await issueTokenPair(user!.id, user!.role)
    return ctx.json(ok({ user: { id: user!.id, email: user!.email, name: user!.name, role: user!.role }, ...tokens }), 201)
  })

  /** POST /auth/login */
  app.post('/auth/login', async ctx => {
    const loginProvider = new LocalAuthProvider()
    try {
      const authUser = await loginProvider.authenticate(ctx)
      if (!authUser) return ctx.json(fail({ _root: ['Invalid email or password'] }), 401)

      const user = await db.query.users.findFirst({ where: eq(users.id, authUser.id) })
      const tokens = await issueTokenPair(authUser.id, authUser.role)
      return ctx.json(ok({ user: { id: user!.id, email: user!.email, name: user!.name, role: user!.role }, ...tokens }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      return ctx.json(fail({ _root: [message] }), 401)
    }
  })

  /** POST /auth/refresh — exchange a refresh token for a new access token */
  app.post('/auth/refresh', async ctx => {
    const body = await ctx.req.json().catch(() => null)
    const rawToken = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['refresh_token'] : null
    if (typeof rawToken !== 'string') return ctx.json(fail({ _root: ['refresh_token required'] }), 400)

    const result = await refreshAccessToken(rawToken)
    if (!result) return ctx.json(fail({ _root: ['Invalid or expired refresh token'] }), 401)

    return ctx.json(ok({ accessToken: result.accessToken }))
  })

  // ── Protected routes (JWT required) ──────────────────────────────────────────

  /** POST /auth/logout — revoke the current access token and optionally the refresh token */
  app.post('/auth/logout', jwtMiddleware, async ctx => {
    const user    = (ctx as any).get('user') as AuthUser
    const payload = (ctx as any).get('jwtPayload') as Record<string, unknown> | undefined
    const body    = await ctx.req.json().catch(() => ({})) as Record<string, unknown>

    // Revoke current access token's jti
    if (payload?.['jti'] && payload?.['exp']) {
      await revokeJti(payload['jti'] as string, new Date((payload['exp'] as number) * 1000))
    }

    // Revoke refresh token if provided
    if (typeof body['refresh_token'] === 'string') {
      await revokeRefreshToken(body['refresh_token'])
    }

    // revoke_all=true: sign out all sessions
    if (body['revoke_all'] === true) {
      await revokeAllUserTokens(user.id)
    }

    return ctx.json(ok({ message: 'Logged out' }))
  })

  /** GET /auth/me — return the current authenticated user */
  app.get('/auth/me', jwtMiddleware, async ctx => {
    const authUser = (ctx as any).get('user') as AuthUser
    const user = await db.query.users.findFirst({ where: eq(users.id, authUser.id) })
    if (!user) return ctx.json(fail({ _root: ['User not found'] }), 404)
    return ctx.json(ok({ id: user.id, email: user.email, name: user.name, role: user.role, active: user.active }))
  })

  /** POST /auth/change-password */
  app.post('/auth/change-password', jwtMiddleware, async ctx => {
    const authUser = (ctx as any).get('user') as AuthUser
    const body = await ctx.req.json().catch(() => null)
    const parsed = changePasswordSchema.safeParse(body)
    if (!parsed.success) {
      return ctx.json(fail(parsed.error.flatten().fieldErrors as Record<string, string[]>), 422)
    }
    const { current_password, new_password } = parsed.data

    const cred = await db.query.user_credentials.findFirst({
      where: eq(user_credentials.user_id, authUser.id),
    })
    if (!cred) return ctx.json(fail({ _root: ['No password set for this account'] }), 400)

    const { compare } = await import('bcryptjs')
    const valid = await compare(current_password, cred.password_hash)
    if (!valid) return ctx.json(fail({ current_password: ['Incorrect current password'] }), 401)

    const new_hash = await hash(new_password, 12)
    await db.update(user_credentials)
      .set({ password_hash: new_hash, updated_at: new Date() })
      .where(eq(user_credentials.user_id, authUser.id))

    // Revoke all existing refresh tokens — force re-login on all devices
    await revokeAllUserTokens(authUser.id)

    return ctx.json(ok({ message: 'Password changed. Please log in again.' }))
  })
}
