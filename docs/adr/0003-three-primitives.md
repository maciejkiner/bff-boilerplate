# ADR-0003: Three-Primitive Resource Architecture

**Status:** Accepted  
**Date:** 2025-05

## Context

REST APIs commonly need three patterns: simple CRUD on a table, stateful multi-step forms, and process flows between multiple users. We needed a single coherent way to implement all three without diverging conventions.

## Decision

Three composable primitives, each building on the previous:

```
BaseCrud          — GET/POST/PUT/PATCH/DELETE on any Drizzle table
SubmissionResource — stateful form submissions with version history + lifecycle
defineWorkflow    — state machine attached to a SubmissionResource
```

## Rationale

**BaseCrud** covers 80% of use cases (reference data, lookup tables, simple entities). It handles pagination, filtering, sorting, field-level permissions, nested resources, bulk ops, and audit logging automatically.

**SubmissionResource** extends BaseCrud with submission-specific concerns: draft/submit/approve lifecycle, version history (every save snapshotted), soft delete, step-by-step wizard support. It does NOT try to be a general workflow engine.

**defineWorkflow** is a pure state machine attached to a SubmissionResource. It knows nothing about HTTP or the database — transitions are pure functions. This makes it independently testable with `WorkflowTestKit` without a DB.

**Why not one class that does everything?**  
A single `Resource` class that handles both simple CRUD and complex workflow would be ~1000 lines with deep conditional branching. The three-primitive split keeps each class focused and overrideable.

## Decision Tree

```
Need to store and retrieve records?
  └─ Yes → BaseCrud
      Does the record go through a lifecycle (draft → submitted → approved)?
        └─ Yes → SubmissionResource
            Does the lifecycle involve multiple users or branching paths?
              └─ Yes → + defineWorkflow
```

## Consequences

- A developer building a simple lookup table (e.g., countries) uses only BaseCrud — no workflow overhead
- A developer building a leave-request system uses all three — each adds a focused layer
- `SubmissionResource` cannot be mounted without `formName` — this is intentional; every submission is namespaced by form
