# Changelog

## [Unreleased]

### Fixed
- DELETE endpoint now returns 204 No Content (was incorrectly returning 200)
- Deleting a non-existent record now returns 404 (was silently returning 200)
- Bulk operations are now wrapped in a database transaction (truly all-or-nothing)
- `SubmissionModel.save()` wraps UPDATE + version INSERT in a transaction (prevents orphaned version records)
- `WorkflowScheduler` uses `setTimeout` chaining — next poll starts only after previous completes (prevents overlapping polls)

### Performance
- Database connection pool configured: `max: 20, idle_timeout: 30s, connect_timeout: 10s`
- Added 6 missing indexes: `audit_events(entity_type, entity_id)`, `audit_events(timestamp)`, `form_submission_versions(submission_id)`, `form_submissions(form_name, deleted_at)`, `form_submissions(workflow_state_entered_at)`, `form_submissions(assigned_to)`
- Audit logging is now fire-and-forget — no longer blocks request completion

### Documentation
- Added Architecture Decision Records in `docs/adr/` (ADR-0001 through ADR-0005)
- Added GitHub Actions CI pipeline (`.github/workflows/ci.yml`)
- Added `CONTRIBUTING.md` with commit convention, branching strategy, and PR checklist

---

## [0.3.0] — 2025-05

### Added
- Vitest testing framework; `npm test` now works
- Example tests: `user-form.test.ts`, `workflow.test.ts` (in-memory), `users.integration.test.ts`
- `server/app.ts` extracted from `index.ts` so tests can import the Hono app independently
- JWT_SECRET validation at server startup — clear fatal error if missing or left as default
- `server/scripts/generate.ts` — `npm run generate resource <Name>` scaffolds and auto-injects
- Graceful `SIGTERM`/`SIGINT` shutdown in `index.ts`
- `noUnusedLocals` + `noUnusedParameters` in tsconfig
- Security note in `.env.example` with secret generation command

### Fixed
- `entrypoint.sh` now exits 1 with a clear message if schema sync fails
- `ModelBase` warns on unknown filter/sort fields instead of silently ignoring them
- `TestClient` and `createTestToken` exported from `core/testing/index.ts`

---

## [0.2.0] — 2025-05

### Added
- Computed fields (`computed<T>`) — read-only derived values, not saved to DB
- Group fields (`group<T>`) — namespaced nested object fields
- `visibleWhen` / `requiredWhen` — serialisable conditional rules
- Plugin validator registry (`validators.register(name, fn)`) with built-ins: `nip`, `regon`, `pesel`, `iban`, `phone_pl`
- `POST /:resource/schema/evaluate` — context-aware schema for dynamic forms
- Workflow parallel branches (`BranchDef`) and TTL timeouts (`ttl` / `onTimeout`)
- `WorkflowScheduler` — polls DB for expired TTL states
- Integration test helpers: `seed`, `testDb`, `TestClient`, `createTestToken`
- `UsersResource` as the canonical example (replaces domain-specific companies)
- Docker: healthcheck on db service, `entrypoint.sh` runs schema sync before start
- `npm run generate` CLI scaffolding

---

## [0.1.0] — 2025-04

### Added
- Initial BFF boilerplate: Hono + Drizzle ORM + Zod + TypeScript
- `BaseCrud` — generic CRUD with pagination, filtering, sorting, lifecycle hooks, bulk ops, nested resources
- `SubmissionResource` — stateful form submissions with version history and soft delete
- `defineWorkflow` — state machine with guards, side effects, graph visualisation
- `defineForm` — code-first form engine with field types, cross-field rules, conditional visibility, field permissions
- JWT authentication middleware
- Audit log (`GET /audit`, `GET /audit/:type/:id`)
- Custom error message system with i18n hook
- Async validators, date/richtext/relation field types
- Multi-step wizard support (`current_step`)
- `FormTestKit`, `WorkflowTestKit`, snapshot utilities
