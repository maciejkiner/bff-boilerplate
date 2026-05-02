# Contributing

## Commit Convention

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

Types: feat | fix | docs | refactor | test | chore | perf
```

Examples:
```
feat: add reports resource with PDF export
fix: return 404 when deleting non-existent record
docs: add ADR for caching strategy
refactor: extract pagination logic to utility
perf: add index on form_submissions.assigned_to
test: integration tests for bulk operations
```

Breaking changes: append `!` after type — `feat!: rename /submissions to /forms`

## Branching

- `main` — stable, always deployable
- Feature branches: `feat/<name>`, fix branches: `fix/<name>`
- Open a PR against `main`; squash-merge preferred

## Adding a New Resource

Use the code generator:
```bash
npm run generate resource <Name>
npm run db:push
```

See [server/CLAUDE.md](server/CLAUDE.md) for architecture details and the 3-file pattern.

## Running Tests

```bash
cd server
npm test                  # in-memory tests (no DB required)

# With Postgres (full suite including integration tests):
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bff \
JWT_SECRET=any-local-secret \
npm test
```

Or use Docker:
```bash
docker-compose up -d db
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bff_db \
JWT_SECRET=any-local-secret \
npm test
```

## Before Submitting a PR

- [ ] `npm run build` passes (type check)
- [ ] `npm test` passes
- [ ] New resources have a `*.test.ts` (form unit test)
- [ ] Public API changes are reflected in README.md
- [ ] Architectural decisions are recorded in `docs/adr/`

## Architecture Decisions

Significant decisions (framework choices, design patterns, trade-offs) belong in `docs/adr/`. Copy the format from an existing ADR. Number sequentially.
