import type { Context } from 'hono'

/**
 * The shape of the authenticated principal set on ctx.get('user').
 * Open for extension: add tenant_id, permissions, email, etc. via custom claims.
 */
export interface AuthUser {
  id:   number
  role: string
  [key: string]: unknown
}

/**
 * An AuthProvider authenticates a single request.
 * Return the AuthUser if authentication succeeds, or null to pass to the next provider.
 * Throw to short-circuit with a 401 (e.g. token present but invalid).
 */
export interface AuthProvider {
  authenticate(ctx: Context): Promise<AuthUser | null>
}
