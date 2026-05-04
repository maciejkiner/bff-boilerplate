# Auth Improvements Backlog

Generated after CTO production readiness review. The current auth layer (`server/src/middleware/auth.ts`) is a 24-line JWT verification stub. It is sufficient for prototypes and internal tools. It is not sufficient for any product that has real users.

This backlog is organized around a **plugin architecture** — the same migration path used to make `AuthPolicy` pluggable. The goal is that teams pick the auth strategy that matches their deployment context without forking the middleware.

---

## The core problem: authentication is hardcoded, not pluggable

Today, `app.ts` wires `authMiddleware` directly:

```ts
app.use('*', authMiddleware)
```

`authMiddleware` is a specific implementation: it reads `Authorization: Bearer <token>`, verifies a HS256 JWT, and puts `{ id, role }` on the context.

This creates several problems:
1. Teams that need sessions, API keys, or OAuth cannot swap in a different strategy without editing core middleware
2. There is no extension point for the `AuthUser` shape (no `tenant_id`, no `permissions`, no custom claims)
3. The JWT implementation has no refresh or revocation — adding these requires modifying the core file

**The fix:** introduce an `AuthProvider` interface that the middleware delegates to. The current JWT logic becomes `JwtAuthProvider`. Teams compose `app.ts` using whichever provider matches their needs.

---

## A-0 · AuthProvider interface (prerequisite for everything below)

**What to build:**

New file: `server/src/core/auth/AuthProvider.ts`

```ts
import type { Context } from 'hono'

/** The shape of the authenticated principal set on ctx.get('user'). */
export interface AuthUser {
  id:   number
  role: string
  [key: string]: unknown   // open for tenant_id, permissions, etc.
}

/**
 * An AuthProvider authenticates a single request.
 * Return null to fall through to the next provider or emit a 401.
 */
export interface AuthProvider {
  authenticate(ctx: Context): Promise<AuthUser | null>
}
```

New factory function: `server/src/core/auth/createAuthMiddleware.ts`

```ts
import { createMiddleware } from 'hono/factory'
import { fail } from '../routing/index.js'
import type { AuthProvider } from './AuthProvider.js'

export function createAuthMiddleware(...providers: AuthProvider[]) {
  return createMiddleware(async (ctx, next) => {
    for (const provider of providers) {
      const user = await provider.authenticate(ctx)
      if (user) {
        ctx.set('user', user)
        return next()
      }
    }
    return ctx.json(fail({ _root: ['Unauthorized'] }), 401)
  })
}
```

Usage in `app.ts`:
```ts
import { createAuthMiddleware } from './core/auth/createAuthMiddleware.js'
import { JwtAuthProvider }      from './core/auth/providers/JwtAuthProvider.js'

app.use('*', createAuthMiddleware(new JwtAuthProvider(config)))
```

The existing `authMiddleware` export becomes a thin wrapper around `createAuthMiddleware(new JwtAuthProvider(config))` for backwards compatibility.

**Acceptance criteria:**
- `createAuthMiddleware` accepts 1..N providers; tries each in order; first non-null result wins
- Existing behaviour unchanged: HS256 JWT in `Authorization: Bearer` header still works
- `AuthUser` interface is exported from `server/src/core/auth/index.ts`
- `AuthPolicy` updated to import `AuthUser` from the new location (not from `middleware/auth.ts`)

**Effort:** half a day

---

## A-1 · JWT refresh tokens

**Problem:** The current JWT has no expiry enforcement and no way to rotate credentials. In practice teams set a very long expiry (or no expiry), which means a stolen token is valid forever. Even with a short expiry there is no way to get a new token without re-logging in.

**What to build:**

`JwtAuthProvider` gains a paired `JwtRefreshProvider`:

```
POST /auth/login     → { accessToken (15 min), refreshToken (7 days) }
POST /auth/refresh   → { accessToken (15 min) }   (requires valid refreshToken)
POST /auth/logout    → invalidates refreshToken
```

Implementation:
- Access tokens: short-lived (15 min), HS256, standard claim set (`sub`, `iat`, `exp`, `role`)
- Refresh tokens: long-lived, stored as a row in a new `refresh_tokens` table (`id`, `user_id`, `token_hash`, `expires_at`, `revoked_at`)
- `POST /auth/refresh` looks up the token hash, checks `revoked_at IS NULL AND expires_at > now()`, issues a new access token
- `POST /auth/logout` sets `revoked_at = now()` on the stored token

New table (Drizzle schema):
```ts
export const refresh_tokens = pgTable('refresh_tokens', {
  id:         serial('id').primaryKey(),
  user_id:    integer('user_id').notNull(),
  token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expires_at: timestamp('expires_at').notNull(),
  revoked_at: timestamp('revoked_at'),
  created_at: timestamp('created_at').defaultNow(),
})
```

**Config additions** (`config.ts`):
```ts
JWT_ACCESS_EXPIRY_SECONDS:  z.coerce.number().default(900),        // 15 min
JWT_REFRESH_EXPIRY_SECONDS: z.coerce.number().default(604800),     // 7 days
```

**Acceptance criteria:**
- `POST /auth/login` with valid credentials returns both tokens
- `POST /auth/refresh` with a valid refresh token returns a new access token without re-logging in
- `POST /auth/logout` revokes the refresh token; subsequent refresh attempts return 401
- Expired access token returns 401 with a clear message (`token_expired` code) that the client can distinguish from `invalid_token`
- Integration test covers the full login → refresh → logout cycle

**Effort:** 2 days

---

## A-2 · Token revocation (access token deny-list)

**Problem:** Even with short-lived access tokens, there is no way to immediately invalidate a token — for example on password change, account suspension, or suspected compromise. The only current defence is waiting for the token to expire.

**What to build:**

A lightweight deny-list stored in the `refresh_tokens` table extended to include access token JTI tracking:

- Every issued access token gets a `jti` (JWT ID) claim — a random UUID
- A new `revoked_jtis` table stores `{ jti, expires_at }` — only needs to hold entries until the token would have expired anyway
- `JwtAuthProvider` checks `revoked_jtis` on each request (Redis preferred; Postgres table acceptable for low traffic)
- `POST /auth/revoke-token` body `{ jti }` — for server-side forced logout
- Scheduled cleanup: delete rows where `expires_at < now()` (cron or on each login)

For teams without Redis, a Postgres-backed check adds ~1 ms per request. For teams with Redis, provide a `RedisTokenStore` that the provider accepts as a dependency:

```ts
new JwtAuthProvider(config, { tokenStore: new RedisTokenStore(redisClient) })
```

Default: Postgres table (no extra infra required).

**Acceptance criteria:**
- Password change endpoint revokes all active tokens for that user
- Revoked token returns 401 within one request (not on next expiry)
- Cleanup job runs on startup and removes expired deny-list entries

**Effort:** 1.5 days

---

## A-3 · API key provider

**Problem:** Machine-to-machine integrations (webhooks, CI jobs, data pipelines) cannot use JWT bearer tokens sensibly — there is no user to log in. They need a stable, long-lived credential with its own rate limit and scope.

**What to build:**

`ApiKeyAuthProvider` — a provider that reads `X-API-Key: <key>` header and looks up the key in a database table:

New table:
```ts
export const api_keys = pgTable('api_keys', {
  id:         serial('id').primaryKey(),
  key_hash:   varchar('key_hash', { length: 64 }).notNull().unique(),
  user_id:    integer('user_id').notNull(),
  role:       varchar('role', { length: 50 }).notNull().default('api'),
  label:      varchar('label', { length: 255 }),
  expires_at: timestamp('expires_at'),
  revoked_at: timestamp('revoked_at'),
  last_used:  timestamp('last_used'),
  created_at: timestamp('created_at').defaultNow(),
})
```

The key itself is never stored — only a SHA-256 hash. The raw key is shown once on creation.

`ApiKeyAuthProvider`:
```ts
export class ApiKeyAuthProvider implements AuthProvider {
  async authenticate(ctx: Context): Promise<AuthUser | null> {
    const key = ctx.req.header('x-api-key')
    if (!key) return null
    const hash = sha256(key)
    const row  = await db.query.api_keys.findFirst({
      where: and(eq(api_keys.key_hash, hash), isNull(api_keys.revoked_at))
    })
    if (!row) return null
    if (row.expires_at && row.expires_at < new Date()) return null
    // Update last_used fire-and-forget
    void db.update(api_keys).set({ last_used: new Date() }).where(eq(api_keys.id, row.id))
    return { id: row.user_id, role: row.role }
  }
}
```

Mount both providers in `app.ts`:
```ts
app.use('*', createAuthMiddleware(
  new JwtAuthProvider(config),
  new ApiKeyAuthProvider(),
))
```

**Acceptance criteria:**
- `X-API-Key` header authenticates without a JWT
- Key rotation: create new key → verify it works → revoke old key
- Expired and revoked keys return 401
- `last_used` is updated on each successful auth (fire-and-forget, not blocking)

**Effort:** 1 day

---

## A-4 · Extensible AuthUser (custom claims)

**Problem:** `AuthUser` is `{ id: number; role: string }`. Real projects need more: `tenant_id` for multi-tenant SaaS, `permissions[]` for fine-grained access, `email` to avoid extra DB lookups, `impersonated_by` for support tooling. Today there is no way to add these without touching core files.

**What to build:**

The `AuthUser` interface is already `{ id, role, [key: string]: unknown }` (after A-0). The `JwtAuthProvider` needs a `claimsMap` option that controls which JWT payload fields are copied into the `AuthUser`:

```ts
new JwtAuthProvider(config, {
  claimsMap: {
    tenant_id:   payload => payload['tid'],
    permissions: payload => payload['perms'] ?? [],
    email:       payload => payload['email'],
  }
})
```

`AuthPolicy` should expose a typed version too:

```ts
// Instead of:
export class TenantPolicy extends AuthPolicy { ... }
// Teams can type-assert at the point of use:
const user = ctx.get('user') as AuthUser & { tenant_id: number }
```

For teams that want full type safety, export a helper:
```ts
export function typedAuthUser<T extends AuthUser>(ctx: Context): T {
  return ctx.get('user') as T
}
```

**Acceptance criteria:**
- JWT payload fields map to `AuthUser` via config — no core file changes needed
- `AuthPolicy` subclasses can access custom claims via type-cast with no runtime errors
- Type helper available for resource-level user access

**Effort:** half a day

---

## A-5 · OAuth 2.0 / OIDC provider

**Problem:** Teams building products for external users cannot ask users to manage passwords locally. They need sign-in via Google, GitHub, Microsoft, or any OIDC-compliant identity provider.

**What to build:**

An `OAuthProvider` that handles the redirect flow and exchanges the code for a local session/JWT. This is significantly more complex than the other items — it involves redirect URIs, state parameters, PKCE, and token exchange.

**Recommended approach:** Wrap a well-tested OIDC client library rather than implementing the protocol from scratch. Options:
- `openid-client` (battle-tested, 10 years, FAPI compliant)
- `arctic` (lightweight, multi-provider, Hono-friendly)

Architecture:
```
GET /auth/oauth/google          → redirect to Google with state + PKCE
GET /auth/oauth/google/callback → exchange code → create/update user → issue JWT pair
```

The `OAuthProvider` itself is not an `AuthProvider` (it doesn't authenticate individual requests) — it's a separate route handler that terminates in issuing a standard JWT pair. Subsequent requests use `JwtAuthProvider` as normal.

New routes:
```ts
app.get('/auth/oauth/:provider',          oauthController.redirect)
app.get('/auth/oauth/:provider/callback', oauthController.callback)
```

Provider config via environment:
```
OAUTH_GOOGLE_CLIENT_ID=...
OAUTH_GOOGLE_CLIENT_SECRET=...
OAUTH_REDIRECT_BASE_URL=https://app.example.com
```

**Acceptance criteria:**
- `GET /auth/oauth/google` redirects to Google consent screen
- Successful OAuth callback creates a user if they don't exist, issues access + refresh tokens
- PKCE and `state` parameter protect against CSRF on the callback
- Works with any OIDC provider (not Google-specific)
- Provider registration is additive — no core file changes to add a new provider

**Effort:** 3–4 days

---

## A-6 · Login / registration endpoints

**Problem:** There are no `POST /auth/login` or `POST /auth/register` endpoints. Teams add these ad hoc in every project, leading to inconsistent password hashing, missing rate limiting, and forgotten audit logs.

**What to build:**

A `LocalAuthProvider` that handles email+password auth. Ships alongside `JwtAuthProvider` — teams opt in.

```
POST /auth/register    { email, password, name? }  → 201 { user }
POST /auth/login       { email, password }          → 200 { accessToken, refreshToken }
POST /auth/logout      { refreshToken }             → 204
POST /auth/refresh     { refreshToken }             → 200 { accessToken }
POST /auth/me          (JWT required)               → 200 { user }
POST /auth/change-password  { current, next }       → 204; revokes all tokens
```

Implementation details:
- Password hashing: `bcrypt` with cost factor 12 (no weaker alternatives)
- Registration rate limit: 5 req/min per IP (stricter than the global 200/min)
- Login rate limit: 10 req/min per IP
- Failed login: always return the same response time (timing-safe — compare hash even when user doesn't exist, using a dummy hash)
- `POST /auth/change-password` calls token revocation (A-2) for all active sessions

**Acceptance criteria:**
- Registration with an existing email returns 409 with a generic message (no user enumeration)
- Login with wrong password returns 401 after the same time as a wrong-user login (timing-safe)
- Rate limit on `/auth/login`: 11th attempt in 1 minute returns 429
- `POST /auth/change-password` invalidates all active access tokens for that user

**Effort:** 2 days

---

## A-7 · Multi-tenancy auth layer

**Problem:** Single `role` field is insufficient for SaaS products where the same user might be an admin of tenant A and a viewer of tenant B. There is no `tenant_id` concept anywhere in the current auth stack.

**What to build:**

This is a design decision, not just a code change. Two viable approaches:

**Option A — tenant_id in JWT + RLS:**
- Add `tenant_id` to the JWT payload (mapped via `claimsMap` from A-4)
- Add `tenant_id` column to all tenant-scoped tables
- Drizzle query layer adds `WHERE tenant_id = ctx.user.tenant_id` automatically via a `TenantModel` base class extending `ModelBase`
- `TenantPolicy` base policy rejects requests where `record.tenant_id !== user.tenant_id`

**Option B — Database schema isolation per tenant:**
- Each tenant gets a Postgres schema (`tenant_<id>.users`, etc.)
- Auth middleware sets `search_path` on each connection
- Higher isolation, much harder to query across tenants

**Recommendation:** Option A for most SaaS products. Option B only if regulatory isolation is required (healthcare, finance).

For Option A:
```ts
export abstract class TenantBaseCrud<...> extends BaseCrud<...> {
  protected readonly tenantScoped = true

  protected override pruneListQuery(query, ctx) {
    const user = this.getUser(ctx) as AuthUser & { tenant_id: number }
    return {
      ...super.pruneListQuery(query),
      filters: [{ field: 'tenant_id', op: 'eq', value: String(user.tenant_id) }, ...query.filters],
    }
  }
}
```

**Acceptance criteria:**
- User from tenant A cannot read records from tenant B, even with a valid JWT
- Filtering by `tenant_id` is automatic — resource authors don't need to add it manually
- Integration test: two tenants, same user ID, cannot cross-read

**Effort:** 3–4 days (Option A)

---

## Summary

| ID | Item | Unblocks | Effort |
|---|---|---|---|
| A-0 | AuthProvider plugin interface | Everything below | half day |
| A-1 | JWT refresh tokens | Production deployments | 2 days |
| A-2 | Token revocation | Forced logout, security incidents | 1.5 days |
| A-3 | API key provider | M2M integrations, CI/CD | 1 day |
| A-4 | Extensible AuthUser claims | Tenant ID, permissions, email | half day |
| A-5 | OAuth 2.0 / OIDC | Social login, SSO | 3–4 days |
| A-6 | Login / registration endpoints | Any product with users | 2 days |
| A-7 | Multi-tenancy | SaaS products | 3–4 days |

**Minimum to use in a real product with external users:** A-0 + A-1 + A-2 + A-6 (~6 days)

**Minimum to recommend to a SaaS team:** all of the above + A-5 + A-7 (~14–16 days total)

---

## Implementation order

```
A-0  (interface)
 ├── A-4  (custom claims)     — can be done simultaneously with A-0
 ├── A-3  (API keys)          — depends on A-0 only
 ├── A-6  (login/register)
 │    ├── A-1  (refresh)      — depends on A-6 for the login endpoint
 │    └── A-2  (revocation)   — depends on A-1 for the revoke flow
 ├── A-5  (OAuth)             — depends on A-1 for token issuance
 └── A-7  (multi-tenancy)     — depends on A-4 for tenant_id in AuthUser
```

A-0 is the only true prerequisite. After A-0, all other items can be developed independently by different engineers.
