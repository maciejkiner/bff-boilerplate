import { compare } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AuthProvider, AuthUser } from '../AuthProvider.js'
import { db } from '../../../db/index.js'
import { users, user_credentials } from '../../../db/schema.js'

/**
 * Authenticates a request by reading `email` and `password` from the JSON body.
 * Use this provider on the login endpoint only — do not add it to the global auth chain.
 */
export class LocalAuthProvider implements AuthProvider {
  async authenticate(ctx: Context): Promise<AuthUser | null> {
    let body: unknown
    try {
      body = await ctx.req.json()
    } catch {
      return null
    }

    if (typeof body !== 'object' || body === null) return null
    const { email, password } = body as Record<string, unknown>
    if (typeof email !== 'string' || typeof password !== 'string') return null

    const user = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) })
    if (!user || !user.active) {
      // Timing-safe: always run compare even when user not found (dummy hash)
      await compare(password, '$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
      throw new Error('Invalid email or password')
    }

    const cred = await db.query.user_credentials.findFirst({
      where: eq(user_credentials.user_id, user.id),
    })
    if (!cred) {
      await compare(password, '$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
      throw new Error('Invalid email or password')
    }

    const valid = await compare(password, cred.password_hash)
    if (!valid) throw new Error('Invalid email or password')

    return { id: user.id, role: user.role }
  }
}
