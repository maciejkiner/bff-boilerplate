# ADR-0006 — Workflow Engine Boundary

**Date:** 2026-05-04  
**Status:** Accepted

## Context

The boilerplate ships a custom `defineWorkflow` engine for modeling business processes on top of `SubmissionResource`. During a CTO-level production readiness review, we evaluated whether to replace it with XState or keep it in place.

## Decision: Keep `defineWorkflow` — document the boundary, harden tests

We chose Option B: document the use-case boundary clearly and add comprehensive tests for the most complex logic (parallel branch merging). We did not adopt XState.

### Why not XState?

- XState is a heavy dependency with a steep learning curve; it introduces significant conceptual overhead for teams building simple approval flows.
- `defineWorkflow` already handles the primary use cases in this boilerplate: linear flows with guard conditions, parallel branches with configurable merge logic (`mergeWhen: 'all' | 'any'`), TTL-based timeouts, and state assignment (`assignTo`).
- The database-polling approach (`WorkflowScheduler`) is intentional — XState does not manage persistent state; we would still need the scheduler layer.
- Migration path to XState is viable later if needed: `WorkflowInstance` is an interface; an XState adapter can be dropped in without changing `SubmissionResource`.

### Tradeoffs accepted

| XState | `defineWorkflow` |
|---|---|
| Visualization tooling (Stately) | No visualization |
| Ecosystem (guards, actors, spawned machines) | Minimal — only what we built |
| Battle-tested edge cases | Must be covered by our own tests |
| Community support | Maintained only by this project |

## Boundary — what `defineWorkflow` is designed for

**Use `defineWorkflow` when:**
- The workflow has a single main path with optional branching (approval → review → approved/rejected)
- Parallel branches: ≤ 2, flat (no nested parallel states)
- TTL timeouts: top-level states only (no nested TTL inside a parallel branch)
- State count: ≤ 15 states
- No need to spawn child machines or communicate across concurrent sessions

**Use XState instead when:**
- The workflow has > 2 parallel branches
- You need nested parallel states (parallel branches within a parallel branch)
- You need TTL timeouts inside a parallel branch state
- You need statechart visualization (Stately) for stakeholder review
- The workflow interacts with external services that themselves have state machines (orchestration pattern)

## Implementation notes

- Branch merge logic lives in `SubmissionResource.ts` (`handleBranchAction`).
- `mergeWhen: 'all'` → merge fires when ALL branch states are final states (defined by the workflow's `final: true` flag on each branch step).
- `mergeWhen: 'any'` → merge fires when the FIRST branch state becomes final.
- Branch states are stored in `form_submissions.branch_states` (JSONB).
- `WorkflowScheduler` polls every 60 s for TTL expirations; interval is configurable at construction time.

## Compliance criteria for this ADR

- [ ] Branch merge logic (`mergeWhen: 'all'` and `mergeWhen: 'any'`) has ≥ 80% branch coverage in `workflow.test.ts`
- [ ] This document exists and is linked from `MAINTAINING.md`
- [ ] New workflow features that exceed the boundary above require a new ADR before implementation
