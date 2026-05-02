# ADR-0004: Custom Workflow State Machine

**Status:** Accepted  
**Date:** 2025-05

## Context

The submission lifecycle needs a state machine. Options considered:

1. **XState** — industry-standard state machine library
2. **Simple status enum + if/else** — no library
3. **Custom `defineWorkflow`** (chosen) — minimal state machine tailored to this use case

## Decision

Custom state machine implemented in `server/src/core/workflow/defineWorkflow.ts`.

## Rationale

**Against XState:**
- XState v5 is ~50kb and has a steep learning curve (actors, spawning, services)
- Our use case is simpler: linear/branching state transitions with async guards and side effects
- XState's serialisation format adds friction when persisting state to PostgreSQL

**Against enum + if/else:**
- Doesn't scale beyond 3-4 states — transition logic becomes unreadable
- No built-in guard system, no side effects framework, no visualisation

**For custom `defineWorkflow`:**
- Fits exactly in ~150 lines
- Guards are plain async functions: `check: async (ctx) => ctx.user?.role === 'manager'`
- Side effects (`onTransition`, `onEnter`) are typed
- `toGraph()` produces a serialisable representation for visualisation
- `WorkflowTestKit` tests transitions without any DB or HTTP
- Parallel branches (`BranchDef`) and TTL timeouts (`ttl`/`onTimeout`) added without external dependencies

## Consequences

- No visual editor (XState has one) — the workflow is defined and documented in code
- No time-travel debugging — but `form_submission_versions` provides an audit trail
- `WorkflowScheduler` handles TTL timeouts via polling — adequate for most use cases; replace with pg_cron or a job queue for sub-minute precision
