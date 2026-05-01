import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { form_submissions, form_submission_versions } from '../../db/schema.js'
import { ModelBase } from '../model/ModelBase.js'
import type { FormSubmission, FormSubmissionInsert, SubmissionStatus } from './types.js'

export class SubmissionModel extends ModelBase<typeof form_submissions, FormSubmissionInsert, FormSubmission> {
  readonly table = form_submissions

  override async save(data: FormSubmissionInsert, id?: number): Promise<FormSubmission> {
    if (id !== undefined) {
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
    }
    const rows = await db.insert(this.table).values(data as any).returning()
    return rows[0] as unknown as FormSubmission
  }

  async setWorkflowState(id: number, workflowState: string): Promise<FormSubmission> {
    const rows = await db
      .update(this.table)
      .set({ workflow_state: workflowState, updated_at: new Date() })
      .where(eq(this.table.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new Error(`Submission ${id} not found`)
    return row as unknown as FormSubmission
  }

  async transition(id: number, to: SubmissionStatus): Promise<FormSubmission> {
    const rows = await db
      .update(this.table)
      .set({ status: to, updated_at: new Date(), version: sql`${this.table.version} + 1` })
      .where(eq(this.table.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new Error(`Submission ${id} not found`)
    return row as unknown as FormSubmission
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

  private async recordVersion(submission: FormSubmission): Promise<void> {
    await db.insert(form_submission_versions).values({
      submission_id: submission.id,
      version:       submission.version,
      data:          submission.data as any,
      changed_by:    submission.created_by,
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
