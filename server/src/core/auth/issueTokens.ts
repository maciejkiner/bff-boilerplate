import { sign } from 'hono/jwt'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { config } from '../../config.js'
import { db } from '../../db/index.js'
import { refresh_tokens, revoked_jtis } from '../../db/schema.js'

export interface TokenPair {
  accessToken:  string
  refreshToken: string
}

/** Issue a short-lived access token + long-lived refresh token for a user. */
export async function issueTokenPair(userId: number, role: string, extra: Record<string, unknown> = {}): Promise<TokenPair> {
  const now  = Math.floor(Date.now() / 1000)
  const jti  = randomUUID()

  const accessToken = await sign(
    { id: userId, role, jti, iat: now, exp: now + config.JWT_ACCESS_EXPIRY_SECONDS, ...extra },
    config.JWT_SECRET,
    'HS256',
  )

  const rawRefresh  = randomBytes(32).toString('hex')
  const refreshHash = createHash('sha256').update(rawRefresh).digest('hex')
  const expiresAt   = new Date(Date.now() + config.JWT_REFRESH_EXPIRY_SECONDS * 1000)

  await db.insert(refresh_tokens).values({ user_id: userId, token_hash: refreshHash, expires_at: expiresAt })

  return { accessToken, refreshToken: rawRefresh }
}

/** Revoke an access token by jti (persists until the token's natural expiry). */
export async function revokeJti(jti: string, expiresAt: Date): Promise<void> {
  await db.insert(revoked_jtis).values({ jti, expires_at: expiresAt }).onConflictDoNothing()
}

/** Revoke a refresh token by its raw value. Returns false if not found. */
export async function revokeRefreshToken(rawToken: string): Promise<boolean> {
  const hash = createHash('sha256').update(rawToken).digest('hex')
  const row  = await db.query.refresh_tokens.findFirst({
    where: eq(refresh_tokens.token_hash, hash),
  })
  if (!row || row.revoked_at) return false
  await db.update(refresh_tokens).set({ revoked_at: new Date() }).where(eq(refresh_tokens.id, row.id))
  return true
}

/** Revoke all refresh tokens for a user (e.g. on password change). */
export async function revokeAllUserTokens(userId: number): Promise<void> {
  const rows = await db.query.refresh_tokens.findMany({
    where: eq(refresh_tokens.user_id, userId),
  })
  for (const row of rows) {
    if (!row.revoked_at) {
      await db.update(refresh_tokens).set({ revoked_at: new Date() }).where(eq(refresh_tokens.id, row.id))
    }
  }
}

/** Exchange a raw refresh token for a new access token. Rotates the refresh token. */
export async function refreshAccessToken(rawToken: string): Promise<{ accessToken: string; userId: number; role: string } | null> {
  const hash = createHash('sha256').update(rawToken).digest('hex')
  const row  = await db.query.refresh_tokens.findFirst({
    where: eq(refresh_tokens.token_hash, hash),
  })

  if (!row || row.revoked_at || row.expires_at < new Date()) return null

  // Fetch the user to get current role (may have changed since token was issued)
  const user = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, row.user_id) })
  if (!user || !user.active) return null

  // Revoke the used refresh token (rotation — one-time use)
  await db.update(refresh_tokens).set({ revoked_at: new Date() }).where(eq(refresh_tokens.id, row.id))

  const now   = Math.floor(Date.now() / 1000)
  const jti   = randomUUID()
  const accessToken = await sign(
    { id: user.id, role: user.role, jti, iat: now, exp: now + config.JWT_ACCESS_EXPIRY_SECONDS },
    config.JWT_SECRET,
    'HS256',
  )

  return { accessToken, userId: user.id, role: user.role }
}

/** Delete expired deny-list entries — call on startup or periodically. */
export async function cleanupExpiredJtis(): Promise<void> {
  const now = new Date()
  const expired = await db.query.revoked_jtis.findMany()
  for (const row of expired) {
    if (row.expires_at < now) {
      await db.delete(revoked_jtis).where(eq(revoked_jtis.jti, row.jti))
    }
  }
}
