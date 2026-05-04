import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AuthProvider, AuthUser } from '../AuthProvider.js'
import { db } from '../../../db/index.js'
import { api_keys } from '../../../db/schema.js'

export class ApiKeyAuthProvider implements AuthProvider {
  async authenticate(ctx: Context): Promise<AuthUser | null> {
    const key = ctx.req.header('x-api-key')
    if (!key) return null

    const hash = createHash('sha256').update(key).digest('hex')

    const row = await db.query.api_keys.findFirst({
      where: and(eq(api_keys.key_hash, hash), isNull(api_keys.revoked_at)),
    })

    if (!row) throw new Error('Invalid API key')
    if (row.expires_at && row.expires_at < new Date()) throw new Error('API key has expired')

    void db
      .update(api_keys)
      .set({ last_used: new Date() })
      .where(eq(api_keys.id, row.id))

    return { id: row.user_id, role: row.role }
  }
}

/** Generates a new API key and returns both the raw key and its hash. */
export function generateApiKey(): { raw: string; hash: string } {
  const raw  = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}
