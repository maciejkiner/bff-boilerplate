import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { form_submissions } from '../../db/schema.js'
import type { WorkflowInstance } from './types.js'
import { logger } from '../../lib/logger.js'

export class WorkflowScheduler {
  private _timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly workflow: WorkflowInstance,
    private readonly formName: string,
  ) {}

  /** Check all submissions for expired state TTLs and fire onTimeout transitions. */
  async checkTimeouts(): Promise<number> {
    const now  = new Date()
    const rows = await db
      .select()
      .from(form_submissions)
      .where(and(
        eq(form_submissions.form_name, this.formName),
        isNull(form_submissions.deleted_at),
        isNotNull(form_submissions.workflow_state),
        isNotNull(form_submissions.workflow_state_entered_at),
      ))

    let fired = 0
    for (const row of rows) {
      if (!row.workflow_state || !row.workflow_state_entered_at) continue
      const state = this.workflow.getState(row.workflow_state)
      if (!state?.ttl || !state?.onTimeout) continue

      const elapsed = (now.getTime() - (row.workflow_state_entered_at as Date).getTime()) / 1000
      if (elapsed < state.ttl) continue

      const result = await this.workflow.transition(state.onTimeout, row.workflow_state)
      if (!result.ok) continue

      await db
        .update(form_submissions)
        .set({
          workflow_state:            result.newState,
          workflow_state_entered_at: now,
          ...(result.assignTo !== undefined ? { assigned_to: result.assignTo } : {}),
        } as any)
        .where(eq(form_submissions.id, row.id))
      fired++
    }
    return fired
  }

  start(intervalMs = 60_000): this {
    const loop = () => {
      this.checkTimeouts()
        .catch(e => logger.error({ err: e }, '[WorkflowScheduler] checkTimeouts failed'))
        .finally(() => { this._timer = setTimeout(loop, intervalMs) })
    }
    loop()
    return this
  }

  stop(): void {
    if (this._timer) clearTimeout(this._timer)
  }
}
