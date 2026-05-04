export { AuthPolicy, RolePolicy, OwnerPolicy, AnyPolicy } from './AuthPolicy.js'
export type { AuthUser, AuthProvider } from './AuthProvider.js'
export { createAuthMiddleware } from './createAuthMiddleware.js'
export { JwtAuthProvider }     from './providers/JwtAuthProvider.js'
export { ApiKeyAuthProvider, generateApiKey } from './providers/ApiKeyAuthProvider.js'
export { LocalAuthProvider }   from './providers/LocalAuthProvider.js'
/** Type-safe helper to read the current user from context with a custom shape. */
export function typedAuthUser<T extends import('./AuthProvider.js').AuthUser>(ctx: import('hono').Context): T {
  return (ctx as any).get('user') as T
}

export {
  issueTokenPair,
  revokeJti,
  revokeRefreshToken,
  revokeAllUserTokens,
  refreshAccessToken,
  cleanupExpiredJtis,
} from './issueTokens.js'
