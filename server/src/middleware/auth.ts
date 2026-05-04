// Re-export AuthUser from canonical location — kept for backwards compatibility with existing imports.
export type { AuthUser } from '../core/auth/AuthProvider.js'
export { createAuthMiddleware } from '../core/auth/createAuthMiddleware.js'

import { createAuthMiddleware } from '../core/auth/createAuthMiddleware.js'
import { JwtAuthProvider }     from '../core/auth/providers/JwtAuthProvider.js'
import { config }              from '../config.js'

/** Default JWT middleware used by the global auth chain. */
export const authMiddleware = createAuthMiddleware(new JwtAuthProvider(config))
