# ADR-0001: Framework Selection — Hono + Drizzle ORM

**Status:** Accepted  
**Date:** 2025-05

## Context

We needed a Node.js HTTP framework and a database toolkit for a BFF (Backend-for-Frontend) boilerplate that would be fast to build on, type-safe, and lightweight enough to understand fully.

Candidates considered:

| Layer | Option A | Option B (chosen) | Option C |
|---|---|---|---|
| HTTP | Express | **Hono** | Fastify |
| ORM | Prisma | **Drizzle ORM** | TypeORM |

## Decision

**Hono** for HTTP, **Drizzle ORM** for database access.

## Rationale

**Hono over Express:**
- Full TypeScript support with typed context (`ctx.get('user')` is typed)
- Built-in JWT middleware, static serving, and logger — no separate packages
- Web-standard `Request`/`Response` — works with Bun, Deno, and Cloudflare Workers, not just Node
- Smaller bundle, simpler mental model

**Hono over Fastify:**
- Less boilerplate for small to medium APIs
- Plugin/middleware system is simpler to learn
- The schema-validation integration (Zod) is more explicit in our stack

**Drizzle ORM over Prisma:**
- SQL-like query builder — developers read queries and know immediately what SQL runs
- No separate `prisma generate` step; schema is just TypeScript
- `drizzle-kit push` for fast iteration in development without migration files
- Supports `exactOptionalPropertyTypes` without workarounds (Prisma has issues with strict TypeScript)

**Drizzle ORM over TypeORM:**
- TypeORM requires decorators and `reflect-metadata` — adds complexity
- TypeORM's type inference is weaker; Drizzle infers insert/select types directly from schema

## Consequences

- Drizzle raw queries use `(table as any)[field]` for dynamic column access — acceptable for internal framework code, documented in CLAUDE.md
- Hono's `ctx.get()` / `ctx.set()` pattern requires careful typing for custom context variables (e.g., `user`, `_parentId`)
- `drizzle-kit push --force` used in Docker entrypoint for fast dev onboarding; production should use `drizzle-kit migrate`
