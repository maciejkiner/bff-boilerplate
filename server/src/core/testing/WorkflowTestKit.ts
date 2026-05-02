import type { TransitionResult, WorkflowContext, WorkflowInstance } from '../workflow/types.js'

// ── Runner (builder) ───────────────────────────────────────────────────────────

export class WorkflowTestKit {
  static start(workflow: WorkflowInstance): WorkflowRunner {
    return new WorkflowRunner(workflow, '', {})
  }
}

export class WorkflowRunner {
  constructor(
    private readonly workflow:  WorkflowInstance,
    private readonly state:     string,
    private readonly wfCtx:     WorkflowContext,
  ) {}

  inState(state: string): WorkflowRunner {
    return new WorkflowRunner(this.workflow, state, this.wfCtx)
  }

  as(user: WorkflowContext['user']): WorkflowRunner {
    return new WorkflowRunner(this.workflow, this.state, { ...this.wfCtx, ...(user ? { user } : {}) })
  }

  withSubmission(submission: Record<string, unknown>): WorkflowRunner {
    return new WorkflowRunner(this.workflow, this.state, { ...this.wfCtx, submission })
  }

  withData(data: Record<string, unknown>): WorkflowRunner {
    return new WorkflowRunner(this.workflow, this.state, { ...this.wfCtx, data })
  }

  async transition(action: string): Promise<WorkflowAssertions> {
    const result = await this.workflow.transition(action, this.state, this.wfCtx)
    return new WorkflowAssertions(result, action, this.state)
  }

  async availableTransitions(): Promise<string[]> {
    const list = await this.workflow.availableTransitions(this.state, this.wfCtx)
    return list.map(t => t.name)
  }

  async canTransition(action: string): Promise<boolean> {
    return this.workflow.canTransition(action, this.state, this.wfCtx)
  }

  async expectCanTransition(action: string): Promise<WorkflowRunner> {
    const can = await this.canTransition(action)
    if (!can) throw new Error(`Expected transition '${action}' to be available from state '${this.state}', but it is not`)
    return this
  }

  async expectCannotTransition(action: string): Promise<WorkflowRunner> {
    const can = await this.canTransition(action)
    if (can) throw new Error(`Expected transition '${action}' to be blocked from state '${this.state}', but it is allowed`)
    return this
  }
}

// ── Assertions ─────────────────────────────────────────────────────────────────

export class WorkflowAssertions {
  constructor(
    private readonly result:    TransitionResult,
    private readonly action:    string,
    private readonly fromState: string,
  ) {}

  get raw(): TransitionResult { return this.result }

  toSucceed(): WorkflowAssertions {
    if (!this.result.ok) {
      throw new Error(
        `Expected transition '${this.action}' from '${this.fromState}' to succeed, ` +
        `but it failed: [${this.result.reason}] ${this.result.message}`,
      )
    }
    return this
  }

  toFail(): WorkflowAssertions {
    if (this.result.ok) {
      throw new Error(
        `Expected transition '${this.action}' from '${this.fromState}' to fail, ` +
        `but it succeeded with newState '${this.result.newState}'`,
      )
    }
    return this
  }

  toBeInState(expected: string): WorkflowAssertions {
    if (!this.result.ok) {
      throw new Error(`Cannot assert state: transition '${this.action}' failed — ${this.result.message}`)
    }
    if (this.result.newState !== expected) {
      throw new Error(`Expected new state '${expected}', got '${this.result.newState}'`)
    }
    return this
  }

  toFailWithReason(reason: 'invalid_transition' | 'guard_failed' | 'side_effect_error'): WorkflowAssertions {
    if (this.result.ok) {
      throw new Error(`Expected failure with reason '${reason}', but transition succeeded`)
    }
    if (this.result.reason !== reason) {
      throw new Error(`Expected failure reason '${reason}', got '${this.result.reason}'`)
    }
    return this
  }

  toFailWithMessage(contains: string): WorkflowAssertions {
    if (this.result.ok) {
      throw new Error(`Expected failure containing '${contains}', but transition succeeded`)
    }
    if (!this.result.message.includes(contains)) {
      throw new Error(`Expected failure message to contain '${contains}', got: '${this.result.message}'`)
    }
    return this
  }

  toHaveAssignedTo(userId: number | null): WorkflowAssertions {
    if (!this.result.ok) {
      throw new Error(`Cannot assert assignTo: transition failed`)
    }
    const actual = this.result.assignTo
    if (actual !== userId) {
      throw new Error(`Expected assignTo '${userId}', got '${actual}'`)
    }
    return this
  }
}
