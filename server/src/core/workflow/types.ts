export type StateType = 'initial' | 'intermediate' | 'final'

export interface StateDef {
  name:   string
  type:   StateType
  label?: string
  meta?:  Record<string, unknown>
}

// ── Guards ────────────────────────────────────────────────────────────────────

export interface WorkflowContext {
  user?:       { id: number; role: string; [key: string]: unknown }
  submission?: Record<string, unknown>
  data?:       Record<string, unknown>
}

export interface Guard {
  check:    (ctx: WorkflowContext) => boolean | Promise<boolean>
  message?: string
}

// ── Transitions ───────────────────────────────────────────────────────────────

export interface TransitionDef {
  name:    string
  from:    string | string[]
  to:      string
  label?:  string
  guards?: Guard[]
}

// ── Workflow definition ───────────────────────────────────────────────────────

export interface WorkflowDef {
  name:        string
  initial:     string
  states:      StateDef[]
  transitions: TransitionDef[]
}

// ── Results ───────────────────────────────────────────────────────────────────

export type TransitionResult =
  | { ok: true;  newState: string }
  | { ok: false; reason: 'invalid_transition'; message: string }
  | { ok: false; reason: 'guard_failed';       message: string }

export interface WorkflowInstance {
  readonly name:    string
  readonly initial: string
  getState(name: string): StateDef | undefined
  getTransition(name: string): TransitionDef | undefined
  availableTransitions(currentState: string, ctx?: WorkflowContext): Promise<TransitionDef[]>
  canTransition(name: string, currentState: string, ctx?: WorkflowContext): Promise<boolean>
  transition(name: string, currentState: string, ctx?: WorkflowContext): Promise<TransitionResult>
  toGraph(): { states: StateDef[]; transitions: Array<Omit<TransitionDef, 'guards'>> }
}
