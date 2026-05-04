import { createMiddleware } from 'hono/factory'
import { fail } from '../routing/index.js'
import type { AuthProvider } from './AuthProvider.js'

/**
 * Creates an auth middleware from one or more providers.
 * Providers are tried in order — the first non-null result wins.
 * If all providers return null the request is rejected with 401.
 */
export function createAuthMiddleware(...providers: AuthProvider[]) {
  return createMiddleware(async (ctx, next) => {
    for (const provider of providers) {
      try {
        const user = await provider.authenticate(ctx)
        if (user) {
          ctx.set('user', user)
          return next()
        }
      } catch (err) {
        // Provider threw — treat as auth failure (token present but invalid)
        const message = err instanceof Error ? err.message : 'Authentication failed'
        return ctx.json(fail({ _root: [message] }), 401)
      }
    }
    return ctx.json(fail({ _root: ['Unauthorized'] }), 401)
  })
}
