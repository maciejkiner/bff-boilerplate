# ADR-0007: Auth Plugin System — AuthProvider Interface

**Status:** Accepted  
**Date:** 2026-05

## Context

The original auth layer was a 24-line middleware (`middleware/auth.ts`) that hardcoded HS256 JWT verification and put `{ id, role }` on context. This worked for prototypes but created three problems for production use:

1. **No swap point** — teams needing API keys, sessions, or OAuth had to edit core middleware files.
2. **Fixed AuthUser shape** — no `tenant_id`, `permissions`, or custom claims without forking.
3. **No token lifecycle** — no refresh, no revocation, no multi-session management.

## Decision

Introduce an `AuthProvider` plugin interface. Authentication strategy becomes a runtime composition, not a compile-time hardcoded choice.

```ts
interface AuthProvider {
  authenticate(ctx: Context): Promise<AuthUser | null>
}
```

A `createAuthMiddleware(...providers)` factory tries providers in order:
- `null` → fall through to the next provider
- `AuthUser` → set on context, proceed
- `throw` → short-circuit with 401 (token present but invalid)

`app.ts` wires providers at startup:
```ts
app.use('*', createAuthMiddleware(new JwtAuthProvider(config), new ApiKeyAuthProvider()))
```

## Providers Shipped

| Provider | Trigger | Use case |
|---|---|---|
| `JwtAuthProvider` | `Authorization: Bearer` | Default — all browser clients |
| `ApiKeyAuthProvider` | `X-API-Key` header | Server-to-server, CI pipelines |
| `LocalAuthProvider` | JSON `{ email, password }` body | Login endpoint only — not in global chain |

OAuth (arctic) is scaffolded in `oauthRoutes.ts` — not a provider (it terminates in a JWT pair).

## Token Lifecycle

`issueTokens.ts` owns the full lifecycle: issue → rotate → revoke — decoupled from any provider.

- Access tokens: HS256 JWT with `jti` (UUID), 15-minute expiry, jti stored in `revoked_jtis` on logout.
- Refresh tokens: 64-char random hex, stored as SHA-256 hash in `refresh_tokens`, one-time-use rotation.
- `cleanupExpiredJtis()` — call on startup or via cron to prune the deny list.

## Extensibility

**Custom claims:** `JwtAuthProvider` accepts `claimsMap` to map payload fields onto `AuthUser`:
```ts
new JwtAuthProvider(config, { claimsMap: { tenant_id: p => p['tid'] } })
```

**Custom provider:** implement `AuthProvider`, pass to `createAuthMiddleware`. No core file changes.

**Multi-tenancy:** `TenantBaseCrud` reads `tenant_id` from `AuthUser` and auto-scopes all queries.

## Consequences

- `middleware/auth.ts` is now a thin re-export shim — existing imports continue to work.
- `ctx.get('jwtPayload')` is set by `JwtAuthProvider` for logout (jti/exp access without re-verifying).
- Route-level middleware (protected auth routes) uses a second `jwtMiddleware` instance — avoids the global middleware's context type conflict.
- `(ctx as any).get('user')` is required in route handlers that receive `jwtMiddleware` as route-level middleware, because Hono's context type only knows `'jwtPayload'` for that chain. This is a Hono typing limitation, not a runtime issue.
