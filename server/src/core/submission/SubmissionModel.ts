import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { form_submissions, form_submission_versions } from '../../db/schema.js'
import { ModelBase } from '../model/ModelBase.js'
import type { ListQuery } from '../crud/listQuery.js'
import type { FormSubmission, FormSubmissionInsert, SubmissionStatus } from './types.js'

export class SubmissionModel extends ModelBase<typeof form_submissions, FormSubmissionInsert, FormSubmission> {
  readonly table = form_submissions

  override async get(id: number): Promise<FormSubmission | null> {
    const rows = await db
      .select()
      .from(this.table)
      .where(and(eq(this.table.id, id), isNull(this.table.deleted_at)))
      .limit(1)
    return (rows[0] as FormSubmission | undefined) ?? null
  }

  override async list(query: ListQuery): Promise<{ rows: FormSubmission[]; total: number }> {
    const withSoftDelete: ListQuery = {
      ...query,
      filters: [{ field: 'deleted_at', op: 'isNull', value: '' }, ...query.filters],
    }
    return super.list(withSoftDelete) as Promise<{ rows: FormSubmission[]; total: number }>
  }

  override async save(data: FormSubmissionInsert, id?: number): Promise<FormSubmission> {
    if (id !== undefined) {
      return db.transaction(async () => {
        const rows = await db
          .update(this.table)
          .set({ ...data, updated_at: new Date(), version: sql`${this.table.version} + 1` })
          .where(eq(this.table.id, id))
          .returning()
        const row = rows[0]
        if (!row) throw new Error(`Submission ${id} not found`)
        const result = row as unknown as FormSubmission
        await this.recordVersion(result)
        return result
      })
    }
    const rows = await db.insert(this.table).values(data as any).returning()
    return rows[0] as unknown as FormSubmission
  }

  async setWorkflowState(
    id:            number,
    workflowState: string,
    assignTo?:     number | null,
    branchStates?: Record<string, string> | null,
  ): Promise<FormSubmission> {
    const patch: Record<string, unknown> = {
      workflow_state:            workflowState,
      workflow_state_entered_at: new Date(),
      updated_at:                new Date(),
    }
    if (assignTo     !== undefined) patch['assigned_to']      = assignTo
    if (branchStates !== undefined) patch['workflow_branches'] = branchStates
    const rows = await db
      .update(this.table)
      .set(patch as any)
      .where(eq(this.table.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new Error(`Submission ${id} not found`)
    return row as unknown as FormSubmission
  }

  async setBranchStates(id: number, branchStates: Record<string, string>): Promise<FormSubmission> {
    const rows = await db
      .update(this.table)
      .set({ workflow_branches: branchStates as any, updated_at: new Date() })
      .where(eq(this.table.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new Error(`Submission ${id} not found`)
    return row as unknown as FormSubmission
  }

  async assignTo(id: number, userId: number | null): Promise<FormSubmission> {
    const rows = await db
      .update(this.table)
      .set({ assigned_to: userId, updated_at: new Date() })
      .where(eq(this.table.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new Error(`Submission ${id} not found`)
    return row as unknown as FormSubmission
  }

  async transition(id: number, to: SubmissionStatus, changedBy?: number | null): Promise<FormSubmission> {
    const rows = await db
      .update(this.table)
      .set({ status: to, updated_at: new Date(), version: sql`${this.table.version} + 1` })
      .where(eq(this.table.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new Error(`Submission ${id} not found`)
    const result = row as unknown as FormSubmission
    await this.recordVersion(result, changedBy ?? null)
    return result
  }

  override async delete(id: number): Promise<void> {
    await this.softDelete(id)
  }

  async softDelete(id: number, changedBy?: number | null): Promise<void> {
    await db
      .update(this.table)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(eq(this.table.id, id))
    if (changedBy !== undefined) {
      const row = await db.select().from(this.table).where(eq(this.table.id, id)).limit(1)
      if (row[0]) await this.recordVersion(row[0] as unknown as FormSubmission, changedBy)
    }
  }

  async undelete(id: number): Promise<FormSubmission> {
    const rows = await db
      .update(this.table)
      .set({ deleted_at: null, updated_at: new Date() })
      .where(eq(this.table.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new Error(`Submission ${id} not found`)
    return row as unknown as FormSubmission
  }

  async getDeleted(id: number): Promise<FormSubmission | null> {
    const rows = await db.select().from(this.table).where(eq(this.table.id, id)).limit(1)
    return (rows[0] as FormSubmission | undefined) ?? null
  }

  async saveStepData(id: number, data: Record<string, unknown>, currentStep: string): Promise<FormSubmission> {
    const rows = await db
      .update(this.table)
      .set({ data, current_step: currentStep, updated_at: new Date(), version: sql`${this.table.version} + 1` })
      .where(eq(this.table.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new Error(`Submission ${id} not found`)
    const result = row as unknown as FormSubmission
    await this.recordVersion(result)
    return result
  }

  async patchData(id: number, partial: Record<string, unknown>): Promise<FormSubmission> {
    const existing = await this.get(id)
    if (!existing) throw new Error(`Submission ${id} not found`)
    const merged = { ...(existing.data as object), ...partial }
    return this.save({ form_name: existing.form_name, status: existing.status, data: merged, created_by: existing.created_by }, id)
  }

  // ── Version history ───────────────────────────────────────────────────────────

  async getHistory(submissionId: number): Promise<VersionRow[]> {
    return db
      .select()
      .from(form_submission_versions)
      .where(eq(form_submission_versions.submission_id, submissionId))
      .orderBy(asc(form_submission_versions.version)) as Promise<VersionRow[]>
  }

  async getVersion(submissionId: number, version: number): Promise<VersionRow | null> {
    const rows = await db
      .select()
      .from(form_submission_versions)
      .where(
        sql`${form_submission_versions.submission_id} = ${submissionId} AND ${form_submission_versions.version} = ${version}`
      )
      .limit(1) as VersionRow[]
    return rows[0] ?? null
  }

  private async recordVersion(submission: FormSubmission, changedBy: number | null = null): Promise<void> {
    await db.insert(form_submission_versions).values({
      submission_id: submission.id,
      version:       submission.version,
      data:          submission.data as any,
      changed_by:    changedBy,
    })
  }
}

export interface VersionRow {
  id:            number
  submission_id: number
  version:       number
  data:          Record<string, unknown>
  changed_by:    number | null
  changed_at:    Date
}
