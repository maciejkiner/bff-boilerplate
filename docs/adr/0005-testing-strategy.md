# ADR-0005: Testing Strategy — No DB Mocking

**Status:** Accepted  
**Date:** 2025-05

## Context

Two common testing approaches for database-backed APIs:

1. **Mock the database** — unit tests run fast, no DB required
2. **Test against a real database** — slower setup, but tests actual SQL behaviour

## Decision

- **Form logic and workflow logic:** in-memory unit tests, no DB, no HTTP
- **API integration tests:** real PostgreSQL, real HTTP via `TestClient`
- **No database mocking**

## Rationale

**Why no DB mocking:**  
This project was started after a prior incident where mocked tests passed but a production migration failed because the mock didn't reflect Postgres's actual constraint behaviour. The lesson: mock tests give false confidence for SQL-heavy code.

**Why in-memory for forms/workflows:**  
`FormDefinition` and `WorkflowInstance` are pure data structures. Their logic (validation, visibility, guard evaluation) doesn't touch the DB. Testing them in-memory with `FormTestKit` and `WorkflowTestKit` is fast (< 10ms per test suite) and covers the real risk surface.

**Why real DB for integration tests:**  
`BaseCrud`, `SubmissionResource`, and model queries must run against actual Postgres to catch: unique constraint violations, transaction rollback behaviour, index misses, and type coercions.

## Implementation

- `FormTestKit` — sync validation + assertion chaining, no DB
- `WorkflowTestKit` — transition assertions, no DB, no HTTP
- `IntegrationTestKit` — `seed`, `testDb.truncateAll()`, `TestClient(app)` — requires `DATABASE_URL`
- Integration tests auto-skip if `DATABASE_URL` is not set (`describe.skipIf(...)`)
- CI can run form/workflow tests always; integration tests need a Postgres service

## Consequences

- Integration tests cannot run without Docker or a Postgres instance
- `npm test` without `DATABASE_URL` runs 19 in-memory tests, skips 8 integration tests — this is intentional and clearly documented
- New resources should have both a form unit test (`*.test.ts`) and an integration test
