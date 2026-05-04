# Maintaining BFF Boilerplate

This project is designed to be adopted and owned by teams. Teams adopting it accept maintenance responsibility for their copy (no upstream release train).

See [ADR-0006](docs/adr/0006-workflow-engine-boundary.md) for the workflow engine scope decision.

---

## Routine dependency updates

```bash
# Check for outdated packages
npm outdated --workspaces

# Security audit (fail on high or critical)
npm audit --audit-level=high

# Update non-breaking minor/patch versions
npm update --workspaces
```

Dependabot opens weekly PRs for server and client packages. Review and merge them; they include the audit result in the PR description.

---

## Drizzle major version upgrade

1. Read the Drizzle [release notes](https://orm.drizzle.team/changelogs) for breaking changes.
2. Update the package version: `npm install -w server drizzle-orm@next`.
3. If column type APIs changed, update `server/src/db/schema.ts`.
4. Regenerate TypeScript types: `npm run generate:types -w server` (if applicable).
5. Run `npm run build -w server` — type errors surface schema mismatches.
6. Run migrations against a local DB: `npm run db:push -w server`.
7. Run integration tests: `DATABASE_URL=... JWT_SECRET=... npm test -w server`.

---

## Hono major version upgrade

1. Read the [Hono changelog](https://github.com/honojs/hono/releases).
2. Check for middleware API changes: `hono/cors`, `hono/body-limit`, `hono/factory`, `hono/jwt`.
3. `npm install -w server hono@next` and run `npm run build -w server`.
4. Update `@hono/node-server` and `hono-rate-limiter` separately — they may lag the major version.

---

## Node.js LTS upgrade

1. Update `Dockerfile`: change `FROM node:22-alpine` to the new LTS version.
2. Update `.github/workflows/ci.yml`: change `node-version` field.
3. Run `npm install` locally with the new Node.js version to refresh `package-lock.json`.
4. Run the full build + test suite.

---

## Security patch process

| Severity | Target response time | Action |
|---|---|---|
| Critical | 24 hours | Patch immediately; deploy out-of-band |
| High | 48 hours | Patch in next deployment window |
| Moderate | 1 week | Address in next sprint |
| Low | 1 month | Track in backlog |

Run `npm audit --json` to get machine-readable output. Use `npm audit fix` for safe auto-fixes; review `--force` fixes manually.

---

## Environment variables

All required environment variables are validated at startup via `server/src/config.ts` (Zod schema). See `.env.example` for the full list. In production, missing or invalid variables cause an immediate process exit with a clear error message.

---

## Single-maintainer adoption note

This boilerplate was built by a single contributor. Teams adopting it should:
- Designate at least two engineers as owners.
- Set up Dependabot (already configured in `.github/dependabot.yml`).
- Add `npm audit --audit-level=high` to CI (already in `.github/workflows/ci.yml`).
- Run integration tests against a real Postgres instance in CI before every merge to `main`.
