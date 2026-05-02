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
