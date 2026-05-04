import { verify } from 'hono/jwt'
import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import type { AuthProvider, AuthUser } from '../AuthProvider.js'
import type { Config } from '../../../config.js'
import { db } from '../../../db/index.js'
import { revoked_jtis } from '../../../db/schema.js'

export interface JwtAuthProviderOptions {
  /**
   * Map additional JWT payload fields onto AuthUser.
   * Example: { tenant_id: p => p['tid'], permissions: p => p['perms'] ?? [] }
   */
  claimsMap?: Record<string, (payload: Record<string, unknown>) => unknown>
  /** Check jti against the revoked_jtis table. Defaults to true. */
  checkRevocation?: boolean
}

export class JwtAuthProvider implements AuthProvider {
  private readonly secret: string
  private readonly claimsMap: JwtAuthProviderOptions['claimsMap']
  private readonly checkRevocation: boolean

  constructor(config: Pick<Config, 'JWT_SECRET'>, opts: JwtAuthProviderOptions = {}) {
    this.secret          = config.JWT_SECRET
    this.claimsMap       = opts.claimsMap
    this.checkRevocation = opts.checkRevocation ?? true
  }

  async authenticate(ctx: Context): Promise<AuthUser | null> {
    const header = ctx.req.header('Authorization')
    if (!header?.startsWith('Bearer ')) return null

    const token   = header.slice(7)
    const payload = await verify(token, this.secret, 'HS256') as Record<string, unknown>

    // Check token revocation by jti
    if (this.checkRevocation && payload['jti']) {
      const revoked = await db.query.revoked_jtis.findFirst({
        where: eq(revoked_jtis.jti, payload['jti'] as string),
      })
      if (revoked) throw new Error('Token has been revoked')
    }

    // Stash raw payload so logout can access jti/exp
    ctx.set('jwtPayload', payload)

    const user: AuthUser = {
      id:   payload['id']   as number,
      role: payload['role'] as string,
    }

    // Map additional claims
    if (this.claimsMap) {
      for (const [key, extract] of Object.entries(this.claimsMap)) {
        user[key] = extract(payload)
      }
    }

    return user
  }
}
