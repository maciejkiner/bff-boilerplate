export type SubmissionStatus = 'draft' | 'submitted' | 'locked' | 'archived'

export interface FormSubmission {
  id:           number
  form_name:    string
  status:       SubmissionStatus
  data:         Record<string, unknown>
  created_by:   number | null
  current_step: string | null
  created_at:   Date
  updated_at:   Date
  version:      number
}

export type FormSubmissionInsert = {
  form_name:    string
  status?:      SubmissionStatus
  data:         Record<string, unknown>
  created_by?:  number | null
  current_step?: string | null
}

// Valid status transitions
export const TRANSITIONS: Record<SubmissionStatus, SubmissionStatus[]> = {
  draft:     ['submitted', 'archived'],
  submitted: ['locked', 'archived'],
  locked:    ['archived'],
  archived:  ['draft'],
}
