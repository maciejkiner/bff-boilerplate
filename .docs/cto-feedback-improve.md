# CTO Feedback — Improvement Backlog

Generated after architecture audit. Items ordered by risk to production deployments, not implementation complexity.

---

## P0 — Must fix before any production deployment

---

### P0-1 · Authorization layer

**Problem:** Any authenticated user can read, write, and delete any resource. There are no ownership checks, role checks, or field-level permission enforcement at the HTTP layer. A regular user can read all other users' records, modify their roles, and browse the full audit log.

**What to build:**
- `AuthPolicy` base class — define `canList`, `canRead`, `canCreate`, `canUpdate`, `canDelete` as overridable methods that receive `(user, record?)` and return `boolean`
- `BaseCrud` calls the policy at each handler; returns 403 if denied
- Built-in ownership policy: `OwnerPolicy` that checks `record.created_by === user.id`
- Built-in role policy: `RolePolicy` that checks `user.role` against an allowlist
- Audit log restricted to `role === 'admin'` by default

**Acceptance criteria:**
- `GET /users` by a non-admin returns only that user's own record (or 403)
- `DELETE /users/2` by user 1 returns 403
- `GET /audit` by non-admin returns 403
- New resources get a no-op policy by default (deny nothing) but a warning in console if no policy is set in development

**Effort:** 3–4 days

---

### P0-2 · CORS configuration

**Problem:** No CORS middleware. Browser requests from any non-same-origin frontend will be rejected. There is no way to configure allowed origins without code changes.

**What to build:**
- Add `hono/cors` middleware to `server/src/app.ts`
- `ALLOWED_ORIGINS` environment variable (comma-separated); validated at startup
- Default to `*` in development, required in production (server refuses to start if not set when `NODE_ENV=production`)

**Acceptance criteria:**
- `OPTIONS /users` returns correct CORS headers
- Server refuses to start in production if `ALLOWED_ORIGINS` is not set
- `.env.example` documents the variable

**Effort:** 2–3 hours

---

### P0-3 · Rate limiting

**Problem:** No rate limiting. The API is open to brute-force attacks on JWT tokens, user enumeration via email unique checks, and resource exhaustion via bulk endpoints.

**What to build:**
- Add `@hono/rate-limit` (or equivalent) middleware
- Default: 200 req/min per IP globally
- Stricter limit on auth-adjacent endpoints (e.g., `POST /users` for registration): 10 req/min per IP
- `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` configurable via environment

**Acceptance criteria:**
- 201st request within a minute returns 429 with `Retry-After` header
- Limit is configurable without code changes

**Effort:** half a day

---

### P0-4 · Request body size limit

**Problem:** Hono has no default body size cap. A single large request can exhaust server memory.

**What to build:**
- Add Hono `bodyLimit` middleware before all routes
- Default cap: 512 KB; configurable via `MAX_BODY_SIZE_KB` env var
- Requests over the limit return 413 with a clear error message

**Acceptance criteria:**
- `POST /users` with a 1 MB body returns 413
- Limit is configurable via environment

**Effort:** 1 hour

---

## P1 — Fix before going beyond a prototype

---

### P1-1 · Structured logging with correlation IDs

**Problem:** All logging is `console.error` with no structure. In production, an audit failure, a validation error, and an unhandled exception look identical. There is no way to trace a request across log lines.

**What to build:**
- Replace `console.error` with a structured logger (`pino` recommended — zero deps, fast, JSON output)
- Each request gets a `requestId` (UUID) injected via middleware; stored in Hono context
- All log calls include `{ requestId, userId, endpoint, durationMs }` at minimum
- Errors logged with stack trace and request context
- Log level configurable via `LOG_LEVEL` env var

**Acceptance criteria:**
- Every log line is valid JSON in production (`NODE_ENV=production`)
- A request ID can be used to find all log lines for a single request
- `console.error` removed from all source files

**Effort:** 1–2 days

---

### P1-2 · Startup environment validation

**Problem:** The server starts successfully with missing or invalid environment variables (except `JWT_SECRET`). A misconfigured deployment silently behaves incorrectly rather than refusing to start.

**What to build:**
- Parse `process.env` through a Zod schema at startup before any other initialization
- Required in production: `DATABASE_URL`, `JWT_SECRET` (min 32 chars), `ALLOWED_ORIGINS`, `NODE_ENV`
- Optional with defaults: `PORT`, `LOG_LEVEL`, `MAX_BODY_SIZE_KB`, `RATE_LIMIT_MAX`
- Print a clear table of all config values (with secrets masked) on startup in development
- Exit 1 immediately if validation fails, with a human-readable error per missing/invalid variable

**Acceptance criteria:**
- Starting without `DATABASE_URL` exits 1 with `"Missing required env var: DATABASE_URL"`
- Starting with `JWT_SECRET=x` (too short) exits 1 with a clear message
- `NODE_ENV=production` without `ALLOWED_ORIGINS` exits 1

**Effort:** half a day

---

### P1-3 · OpenAPI / schema generation

**Problem:** There is no machine-readable API contract. Frontend developers, integration teams, and API consumers have no way to discover endpoints without reading source code.

**What to build:**
- Generate an OpenAPI 3.1 spec from `ResourceRegistry` at startup
- Each registered resource contributes its endpoints and schema (derived from `FormDefinition.toSchema()`)
- Serve the spec at `GET /openapi.json`
- Serve Swagger UI at `GET /docs` (development only)
- SubmissionResource endpoints and workflow endpoints included

**Acceptance criteria:**
- `GET /openapi.json` returns a valid OpenAPI 3.1 document
- All CRUD endpoints appear with request/response schemas
- Swagger UI renders correctly in development

**Effort:** 3–4 days

---

### P1-4 · FormController dual-state cleanup

**Problem:** `FormController` maintains its own `useState<Record<string, unknown>>` for field values that runs in parallel with `engine.values`. This means two sources of truth for the same data. On load/reset, the component state and engine state can diverge, causing stale values to appear in the UI.

**What to build:**
- Remove `useState` from `FormController`
- Read values directly from `engine.values` (already available via `useSyncExternalStore` snapshot)
- `onChange` calls `engine.setValues()` only — no local state update
- Verify `WizardController` has the same fix applied (it has the same pattern)

**Acceptance criteria:**
- `engine.load(existingRecord)` immediately updates all field values in the UI without a re-render cycle
- `engine.reset()` clears the form without stale values persisting
- No `useState` for form values in `FormController` or `WizardController`

**Effort:** half a day

---

### P1-5 · Graceful shutdown with request draining

**Problem:** `SIGTERM` handler calls `process.exit(0)` immediately. In-flight requests are dropped, database connections may not close cleanly, and any buffered writes are lost.

**What to build:**
- Track the Hono server handle from `serve()`
- On `SIGTERM`/`SIGINT`: stop accepting new connections, wait for in-flight requests to complete (max 30 s timeout), close the database pool, then exit
- Log each phase of shutdown

**Acceptance criteria:**
- A request in-flight at shutdown completes before the process exits
- The database pool is explicitly closed before exit (no connection leak warnings)
- Shutdown completes within 30 seconds regardless of stuck requests

**Effort:** 2–3 hours

---

## P2 — Improve before scaling the team

---

### P2-1 · Replace custom workflow engine with XState (or document the boundary)

**Problem:** `defineWorkflow` re-implements concepts XState has solved — parallel states (branches), timeouts, guards, visualization. The parallel branch merge logic (`mergeWhen: 'all' | 'any'`) is complex custom code that will accumulate edge-case bugs. There is no community or ecosystem around this implementation.

**Two options (pick one):**

**Option A — Replace with XState:**
- Wrap XState machines as `WorkflowInstance` implementing the same interface
- Keep `WorkflowScheduler` for DB-polling of TTL states (XState does not handle this)
- Migration path for existing `defineWorkflow` callers

**Option B — Document the boundary and harden the implementation:**
- Clearly document that `defineWorkflow` is intended for simple linear/branching flows only
- Add a complexity warning: if a workflow has more than 2 parallel branches or nested TTL timeouts, use XState
- Add comprehensive tests for the branch merge logic specifically
- Do not add new features to `defineWorkflow`

**Acceptance criteria (Option B):**
- Branch merge logic has 100% branch coverage in tests
- Documentation explicitly states the use-case boundary
- A decision record (ADR-0006) documents why XState was evaluated and the tradeoffs

**Effort:** Option A: 1–2 weeks · Option B: 2 days

---

### P2-2 · Authorization — field-level data scoping

**Problem:** `toRedacted()` handles field visibility based on `FormContext`, but the context is not populated with the authenticated user on most list/get responses. A user with `role: 'user'` receives the same response shape as `role: 'admin'`. Sensitive fields marked `visible: ctx => ctx.user?.role === 'admin'` are only redacted if the resource explicitly wires the user into the form context.

**What to build:**
- `BaseCrud` automatically populates `FormContext.user` from `ctx.get('user')` when calling `toRedacted()`
- `SubmissionResource` does the same
- Add a test: admin sees `salary` field, user gets `null`

**Acceptance criteria:**
- `GET /users/1` as a non-admin does not return fields marked `visible: ctx => ctx.user?.role === 'admin'`
- No resource needs to manually wire user context for field redaction to work

**Effort:** half a day

---

### P2-3 · DataTable — replace or extend with TanStack Table

**Problem:** The `DataTable` component we built is sufficient for simple lists but lacks features that backoffice projects consistently need: virtual scrolling for large datasets, column resizing, row selection for bulk actions, sticky header, column reordering. Building these from scratch costs more than adopting TanStack Table.

**What to build:**
- Replace the current `DataTable` implementation with a TanStack Table adapter
- Keep the `ListEngine` and `useListResource` hook unchanged (the state management is sound)
- `DataTable` becomes a thin rendering layer over TanStack Table, driven by `engine.columns` and `engine.rows`
- Existing API (`onEdit`, `onDelete`, `renderActions`) preserved

**Acceptance criteria:**
- Row selection with bulk-action support (wires to `POST /resource/bulk`)
- Column resizing and reordering work
- Lists of 1000+ rows scroll smoothly (virtualized)
- `ColumnDef.render` still works as a custom cell renderer

**Effort:** 2–3 days

---

### P2-4 · Multi-stage Docker build

**Problem:** The Docker image builds both server and client in a single stage, copies `node_modules` into the image, and does not prune dev dependencies. The resulting image is large (likely 600 MB+), which slows CI, increases attack surface, and costs money in registries.

**What to build:**
- Multi-stage Dockerfile: `builder` stage runs `npm ci` and `npm run build`; `runtime` stage copies only `dist/` and production deps
- `.dockerignore` excludes `node_modules`, `*.log`, `drizzle/`, `client/src/`, `server/src/`
- Image should be under 150 MB

**Acceptance criteria:**
- `docker build` produces an image under 150 MB
- `npm run dev` still works outside Docker (no build changes needed for local dev)

**Effort:** 2–3 hours

---

### P2-5 · Bus factor — contribution and maintenance documentation

**Problem:** The project has one contributor. There is no documented process for dependency updates, security patches, or breaking change handling. A team adopting this needs to know what they are taking on.

**What to build:**
- `MAINTAINING.md`: documents how to update dependencies (`npm audit`, Drizzle major versions, Hono major versions), how to handle breaking changes, and what the upgrade path looks like
- GitHub Dependabot config (`.github/dependabot.yml`) for automated dependency PRs
- ADR-0006 (or update existing ADRs): explicitly notes that this is a single-maintainer project and teams adopting it accept maintenance ownership

**Acceptance criteria:**
- A new developer can answer "how do I update Drizzle to the next major version?" by reading `MAINTAINING.md`
- Dependabot opens PRs for outdated dependencies automatically

**Effort:** half a day

---

## P3 — Quality of life improvements

| # | Item | Why | Effort |
|---|---|---|---|
| P3-1 | HTTPS enforcement + HSTS header | Redirect HTTP→HTTPS in production; add `Strict-Transport-Security` header | 1 hour |
| P3-2 | `?fields=` sparse fieldsets on list endpoint | Already documented in README, not implemented in `BaseCrud` | half a day |
| P3-3 | Optimistic locking on `PUT` | Prevent lost updates when two users edit the same record concurrently; compare `updated_at` or `version` | 1 day |
| P3-4 | Soft deletes on `BaseCrud` as a first-class option | Currently only `SubmissionResource` has soft delete; `BaseCrud` subclasses must implement `beforeDelete` override manually | half a day |
| P3-5 | Frontend: replace esbuild bare script with Vite | HMR, CSS modules, better dev experience, plugin ecosystem | 1 day |
| P3-6 | `npm audit` in CI | Add `npm audit --audit-level=high` step to `.github/workflows/ci.yml` | 30 min |
| P3-7 | Connection pool metrics | Log pool exhaustion events; expose a `GET /metrics` endpoint for Prometheus scraping | 1 day |

---

## Summary

| Priority | Items | Total effort |
|---|---|---|
| P0 — production blockers | 4 items | ~1 week |
| P1 — pre-scale hardening | 5 items | ~1 week |
| P2 — team scale improvements | 5 items | ~2 weeks |
| P3 — quality of life | 7 items | ~1 week |

**Minimum to use in a real project:** complete all P0 items (roughly one focused sprint).

**Minimum to recommend to a team with confidence:** P0 + P1 items.

P2 and P3 can be tackled incrementally as the project grows.
