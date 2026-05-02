# ADR-0002: Code-First Form Engine Design

**Status:** Accepted  
**Date:** 2025-05

## Context

Forms in this BFF have multiple roles: they validate incoming API payloads, generate UI schema for the frontend, enforce field-level permissions, and drive conditional visibility. We needed to decide how to represent form definitions.

Options:
1. **JSON/YAML configuration** — forms defined in static files, parsed at runtime
2. **Database-driven** — form schema stored in DB, fetched per request
3. **Code-first (chosen)** — forms defined as TypeScript objects, compiled into the app

## Decision

Code-first form definitions using `defineForm<TInput>([...fields])`.

## Rationale

- **Type safety:** `TInput` binds the form to the DB model's insert type. Typos in field names are compile-time errors, not runtime surprises.
- **Colocation:** Form logic lives next to the resource it belongs to (`users/form.ts` next to `users/model.ts`).
- **No runtime parsing:** No YAML/JSON deserialisation, no DB round-trip for schema on every request.
- **Full power of TypeScript:** `visible: (ctx) => ctx.user?.role === 'admin'` — arbitrary logic in visibility/editability callbacks, not a limited DSL.
- **Testable without HTTP:** `FormTestKit.fill(form, values).expectValid()` runs entirely in memory.

**Against JSON config:** Would require a custom DSL for conditionals, validators, and cross-field rules. TypeScript is already a better DSL.

**Against database-driven:** Adds latency per request, requires a form-editor UI, and loses compile-time type safety.

## Consequences

- Forms cannot be changed without a redeployment (intentional — schema changes are code changes)
- `evaluateSchema` endpoint (`POST /users/schema/evaluate`) lets the frontend get a context-aware schema at runtime for dynamic UIs
- The `FormDefinition<TInput>` type is the single source of truth — validation, UI schema, and permissions all derive from it
