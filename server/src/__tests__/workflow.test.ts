/**
 * Example: workflow transition tests using WorkflowTestKit.
 *
 * These run entirely in-memory — no database, no HTTP.
 * Define a simple leave-request workflow inline to illustrate the patterns.
 */
import { describe, it, expect } from 'vitest'
import { WorkflowTestKit } from '../core/testing/index.js'
import { defineWorkflow } from '../core/workflow/index.js'

// ── Minimal example workflow ───────────────────────────────────────────────────

const leaveWorkflow = defineWorkflow({
  name:    'leave',
  initial: 'draft',
  states: [
    { name: 'draft',    type: 'initial'      as const },
    { name: 'pending',  type: 'intermediate' as const },
    { name: 'approved', type: 'final'        as const },
    { name: 'rejected', type: 'final'        as const },
  ],
  transitions: [
    { name: 'submit',  from: 'draft',   to: 'pending' },
    {
      name: 'approve', from: 'pending', to: 'approved',
      guards: [{
        check:   (ctx) => Promise.resolve(ctx.user?.role === 'manager'),
        message: 'Only managers can approve',
      }],
    },
    {
      name: 'reject',  from: 'pending', to: 'rejected',
      guards: [{
        check:   (ctx) => Promise.resolve(ctx.user?.role === 'manager'),
        message: 'Only managers can reject',
      }],
    },
    { name: 'reopen', from: 'rejected', to: 'draft' },
  ],
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('leaveWorkflow — basic transitions', () => {
  it('initial state is draft', () => {
    expect(leaveWorkflow.initial).toBe('draft')
  })

  it('submit moves draft → pending', async () => {
    await WorkflowTestKit
      .start(leaveWorkflow)
      .inState('draft')
      .transition('submit')
      .then(a => a.toSucceed().toBeInState('pending'))
  })

  it('cannot submit from approved', async () => {
    await WorkflowTestKit
      .start(leaveWorkflow)
      .inState('approved')
      .transition('submit')
      .then(a => a.toFail().toFailWithReason('invalid_transition'))
  })
})

describe('leaveWorkflow — guard enforcement', () => {
  const manager  = { id: 10, role: 'manager' }
  const employee = { id: 20, role: 'user' }

  it('manager can approve', async () => {
    await WorkflowTestKit
      .start(leaveWorkflow)
      .inState('pending')
      .as(manager)
      .transition('approve')
      .then(a => a.toSucceed().toBeInState('approved'))
  })

  it('non-manager cannot approve', async () => {
    await WorkflowTestKit
      .start(leaveWorkflow)
      .inState('pending')
      .as(employee)
      .transition('approve')
      .then(a => a.toFail().toFailWithReason('guard_failed').toFailWithMessage('Only managers'))
  })

  it('manager can reject', async () => {
    await WorkflowTestKit
      .start(leaveWorkflow)
      .inState('pending')
      .as(manager)
      .transition('reject')
      .then(a => a.toSucceed().toBeInState('rejected'))
  })
})

// ── Parallel branch merge tests ────────────────────────────────────────────────

const reviewWorkflow = defineWorkflow({
  name:    'review',
  initial: 'submitted',
  states: [
    { name: 'submitted', type: 'initial' as const },
    {
      name:            'in_review',
      type:            'intermediate' as const,
      mergeWhen:       'all' as const,
      mergeTransition: 'all_approved',
      branches: [
        {
          name:    'legal',
          initial: 'pending',
          states: [
            { name: 'pending',  type: 'intermediate' as const },
            { name: 'approved', type: 'final'        as const },
            { name: 'rejected', type: 'final'        as const },
          ],
          transitions: [
            { name: 'approve', from: 'pending', to: 'approved' },
            { name: 'reject',  from: 'pending', to: 'rejected' },
          ],
        },
        {
          name:    'finance',
          initial: 'pending',
          states: [
            { name: 'pending',  type: 'intermediate' as const },
            { name: 'approved', type: 'final'        as const },
            { name: 'rejected', type: 'final'        as const },
          ],
          transitions: [
            { name: 'approve', from: 'pending', to: 'approved' },
            { name: 'reject',  from: 'pending', to: 'rejected' },
          ],
        },
      ],
    },
    { name: 'approved', type: 'final' as const },
    { name: 'rejected', type: 'final' as const },
  ],
  transitions: [
    { name: 'start_review', from: 'submitted',  to: 'in_review' },
    { name: 'all_approved', from: 'in_review',  to: 'approved' },
  ],
})

const anyReviewWorkflow = defineWorkflow({
  name:    'any_review',
  initial: 'submitted',
  states: [
    { name: 'submitted', type: 'initial' as const },
    {
      name:            'in_review',
      type:            'intermediate' as const,
      mergeWhen:       'any' as const,
      mergeTransition: 'first_approved',
      branches: [
        {
          name:    'teamA',
          initial: 'pending',
          states: [
            { name: 'pending',  type: 'intermediate' as const },
            { name: 'approved', type: 'final'        as const },
          ],
          transitions: [{ name: 'approve', from: 'pending', to: 'approved' }],
        },
        {
          name:    'teamB',
          initial: 'pending',
          states: [
            { name: 'pending',  type: 'intermediate' as const },
            { name: 'approved', type: 'final'        as const },
          ],
          transitions: [{ name: 'approve', from: 'pending', to: 'approved' }],
        },
      ],
    },
    { name: 'fast_approved', type: 'final' as const },
  ],
  transitions: [
    { name: 'start_review',  from: 'submitted', to: 'in_review' },
    { name: 'first_approved', from: 'in_review', to: 'fast_approved' },
  ],
})

describe('parallel branch merge — mergeWhen: all', () => {
  it('initBranchStates creates initial branch states', () => {
    const states = reviewWorkflow.initBranchStates('in_review')
    expect(states).toEqual({ legal: 'pending', finance: 'pending' })
  })

  it('first branch approval does not trigger merge', async () => {
    const initial = reviewWorkflow.initBranchStates('in_review')!
    const result = await reviewWorkflow.transitionBranch('legal', 'approve', initial)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.merged).toBe(false)
      expect(result.branchStates['legal']).toBe('approved')
      expect(result.branchStates['finance']).toBe('pending')
    }
  })

  it('second branch approval triggers merge when mergeWhen=all', async () => {
    const initial  = reviewWorkflow.initBranchStates('in_review')!
    const afterOne = await reviewWorkflow.transitionBranch('legal', 'approve', initial)
    expect(afterOne.ok && afterOne.merged).toBe(false)

    const afterTwo = await reviewWorkflow.transitionBranch('finance', 'approve', (afterOne as any).branchStates)
    expect(afterTwo.ok).toBe(true)
    if (afterTwo.ok) {
      expect(afterTwo.merged).toBe(true)
      if (afterTwo.merged) expect(afterTwo.mergeTransition).toBe('all_approved')
    }
  })

  it('mixed final states (one approved, one rejected) still triggers merge on mergeWhen=all', async () => {
    const initial  = reviewWorkflow.initBranchStates('in_review')!
    const afterOne = await reviewWorkflow.transitionBranch('legal', 'approve', initial)
    const afterTwo = await reviewWorkflow.transitionBranch('finance', 'reject', (afterOne as any).branchStates)
    // Both branches are in final states (approved + rejected) — merge fires
    expect(afterTwo.ok && afterTwo.merged).toBe(true)
  })

  it('non-final state does not count toward all-merge', async () => {
    const states = reviewWorkflow.initBranchStates('in_review')!
    // Only legal approved, finance still pending (non-final)
    const result = await reviewWorkflow.transitionBranch('legal', 'approve', states)
    expect(result.ok && result.merged).toBe(false)
  })

  it('returns false for unknown branch name', async () => {
    const states = reviewWorkflow.initBranchStates('in_review')!
    const result = await reviewWorkflow.transitionBranch('unknown', 'approve', states)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_transition')
  })

  it('returns false for invalid transition from current state', async () => {
    const initial  = reviewWorkflow.initBranchStates('in_review')!
    const approved = await reviewWorkflow.transitionBranch('legal', 'approve', initial)
    // Already approved — approve again should fail (no approve from approved)
    const again = await reviewWorkflow.transitionBranch('legal', 'approve', (approved as any).branchStates)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toBe('invalid_transition')
  })
})

describe('parallel branch merge — mergeWhen: any', () => {
  it('first branch approval immediately triggers merge', async () => {
    const initial = anyReviewWorkflow.initBranchStates('in_review')!
    const result  = await anyReviewWorkflow.transitionBranch('teamA', 'approve', initial)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.merged).toBe(true)
      if (result.merged) expect(result.mergeTransition).toBe('first_approved')
    }
  })

  it('second branch approval also triggers merge (idempotent)', async () => {
    const initial = anyReviewWorkflow.initBranchStates('in_review')!
    const result  = await anyReviewWorkflow.transitionBranch('teamB', 'approve', initial)
    expect(result.ok && result.merged).toBe(true)
  })
})

describe('available branch transitions', () => {
  it('lists available transitions for a branch', async () => {
    const states = reviewWorkflow.initBranchStates('in_review')!
    const transitions = await reviewWorkflow.availableBranchTransitions('legal', states)
    const names = transitions.map(t => t.name)
    expect(names).toContain('approve')
    expect(names).toContain('reject')
  })

  it('returns empty when branch is in final state', async () => {
    const initial  = reviewWorkflow.initBranchStates('in_review')!
    const afterOne = await reviewWorkflow.transitionBranch('legal', 'approve', initial)
    const transitions = await reviewWorkflow.availableBranchTransitions('legal', (afterOne as any).branchStates)
    expect(transitions).toHaveLength(0)
  })
})

describe('leaveWorkflow — available transitions', () => {
  it('shows submit from draft', async () => {
    const transitions = await WorkflowTestKit
      .start(leaveWorkflow)
      .inState('draft')
      .availableTransitions()
    expect(transitions).toContain('submit')
  })

  it('shows approve + reject for managers in pending', async () => {
    const transitions = await WorkflowTestKit
      .start(leaveWorkflow)
      .inState('pending')
      .as({ id: 1, role: 'manager' })
      .availableTransitions()
    expect(transitions).toContain('approve')
    expect(transitions).toContain('reject')
  })

  it('shows no transitions for employee in pending', async () => {
    const transitions = await WorkflowTestKit
      .start(leaveWorkflow)
      .inState('pending')
      .as({ id: 2, role: 'user' })
      .availableTransitions()
    expect(transitions).toHaveLength(0)
  })
})
