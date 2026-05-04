/**
 * OAuth 2.0 / OIDC routes (A-5).
 *
 * Uses `arctic` for provider-specific OAuth flows (PKCE + state validation).
 * Requires per-provider env vars:
 *   OAUTH_GOOGLE_CLIENT_ID, OAUTH_GOOGLE_CLIENT_SECRET
 *   OAUTH_REDIRECT_BASE_URL  (e.g. https://app.example.com)
 *
 * Flow:
 *   GET  /auth/oauth/:provider          → redirect to provider consent screen
 *   GET  /auth/oauth/:provider/callback → exchange code → create user → issue JWT pair
 *
 * To enable:
 *   1. npm install -w server arctic
 *   2. Add env vars above to .env.example and config.ts schema
 *   3. Call mountOAuthRoutes(app) in app.ts (before authMiddleware)
 *   4. Implement each provider block below
 */

import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users, oauth_accounts } from '../../db/schema.js'
import { issueTokenPair } from '../../core/auth/issueTokens.js'
import { ok, fail } from '../../core/routing/index.js'

// ── In-memory state store (swap for Redis in production) ──────────────────────
const stateStore = new Map<string, { provider: string; expiresAt: number }>()

function generateState(provider: string): string {
  const state = randomBytes(16).toString('hex')
  stateStore.set(state, { provider, expiresAt: Date.now() + 10 * 60 * 1000 })
  return state
}

function consumeState(state: string, provider: string): boolean {
  const entry = stateStore.get(state)
  stateStore.delete(state)
  if (!entry) return false
  if (entry.provider !== provider) return false
  if (entry.expiresAt < Date.now()) return false
  return true
}

// ── Provider registry ─────────────────────────────────────────────────────────

interface OAuthProfile {
  providerUserId: string
  email:          string
  name:           string
}

interface OAuthProviderHandler {
  buildRedirectUrl(state: string, codeVerifier: string): Promise<URL>
  exchangeCode(code: string, codeVerifier: string): Promise<OAuthProfile>
}

const providerHandlers: Record<string, () => OAuthProviderHandler> = {
  // Uncomment and implement once `arctic` is installed:
  //
  // google: () => {
  //   const { Google } = require('arctic')
  //   const client = new Google(
  //     process.env['OAUTH_GOOGLE_CLIENT_ID']!,
  //     process.env['OAUTH_GOOGLE_CLIENT_SECRET']!,
  //     `${process.env['OAUTH_REDIRECT_BASE_URL']}/auth/oauth/google/callback`,
  //   )
  //   return {
  //     async buildRedirectUrl(state, codeVerifier) {
  //       return client.createAuthorizationURL(state, codeVerifier, ['openid', 'email', 'profile'])
  //     },
  //     async exchangeCode(code, codeVerifier) {
  //       const tokens  = await client.validateAuthorizationCode(code, codeVerifier)
  //       const idToken = tokens.idToken()
  //       // decode idToken or fetch /userinfo
  //       const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString())
  //       return { providerUserId: payload.sub, email: payload.email, name: payload.name }
  //     },
  //   }
  // },
}

// ── Route handlers ────────────────────────────────────────────────────────────

export function mountOAuthRoutes(app: Hono): void {
  /** GET /auth/oauth/:provider — redirect to provider */
  app.get('/auth/oauth/:provider', async ctx => {
    const provider = ctx.req.param('provider')
    const factory  = providerHandlers[provider]
    if (!factory) return ctx.json(fail({ _root: [`Unknown OAuth provider: ${provider}`] }), 400)

    const state        = generateState(provider)
    const codeVerifier = randomBytes(32).toString('hex')
    const handler      = factory()
    const url          = await handler.buildRedirectUrl(state, codeVerifier)

    // Store codeVerifier in a short-lived cookie (HttpOnly, SameSite=Lax)
    ctx.header('Set-Cookie', `oauth_cv=${codeVerifier}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`)
    return ctx.redirect(url.toString())
  })

  /** GET /auth/oauth/:provider/callback — exchange code, issue JWT pair */
  app.get('/auth/oauth/:provider/callback', async ctx => {
    const provider = ctx.req.param('provider')
    const factory  = providerHandlers[provider]
    if (!factory) return ctx.json(fail({ _root: [`Unknown OAuth provider: ${provider}`] }), 400)

    const { code, state } = ctx.req.query() as { code?: string; state?: string }
    if (!code || !state) return ctx.json(fail({ _root: ['Missing code or state'] }), 400)
    if (!consumeState(state, provider)) return ctx.json(fail({ _root: ['Invalid or expired state'] }), 400)

    // Read codeVerifier from cookie
    const cookies      = ctx.req.header('cookie') ?? ''
    const codeVerifier = cookies.match(/oauth_cv=([^;]+)/)?.[1]
    if (!codeVerifier) return ctx.json(fail({ _root: ['Missing PKCE verifier'] }), 400)

    let profile: OAuthProfile
    try {
      profile = await factory().exchangeCode(code, codeVerifier)
    } catch {
      return ctx.json(fail({ _root: ['OAuth code exchange failed'] }), 401)
    }

    // Find or create the oauth_accounts row
    let oauthRow = await db.query.oauth_accounts.findFirst({
      where: (t, { and, eq }) => and(eq(t.provider, provider), eq(t.provider_id, profile.providerUserId)),
    })

    let userId: number
    if (oauthRow) {
      userId = oauthRow.user_id
    } else {
      // Find existing user by email or create new one
      let user = await db.query.users.findFirst({ where: eq(users.email, profile.email.toLowerCase()) })
      if (!user) {
        const [inserted] = await db.insert(users)
          .values({ email: profile.email.toLowerCase(), name: profile.name, role: 'user' })
          .returning()
        user = inserted!
      }
      userId = user.id
      await db.insert(oauth_accounts).values({
        user_id:     userId,
        provider,
        provider_id: profile.providerUserId,
        email:       profile.email,
        name:        profile.name,
      })
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!user || !user.active) return ctx.json(fail({ _root: ['Account disabled'] }), 403)

    const tokens = await issueTokenPair(user.id, user.role)

    // Clear the PKCE cookie
    ctx.header('Set-Cookie', 'oauth_cv=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
    return ctx.json(ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, ...tokens }))
  })
}
