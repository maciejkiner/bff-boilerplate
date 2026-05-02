export type StateType = 'initial' | 'intermediate' | 'final'

// ── Contexts ──────────────────────────────────────────────────────────────────

export interface WorkflowContext {
  user?:       { id: number; role: string; [key: string]: unknown }
  submission?: Record<string, unknown>
  data?:       Record<string, unknown>
}

export interface SideEffectContext extends WorkflowContext {
  transition: string
  fromState:  string
  toState:    string
}

// ── Guards ────────────────────────────────────────────────────────────────────

export interface Guard {
  check:    (ctx: WorkflowContext) => boolean | Promise<boolean>
  message?: string
}

// ── Parallel branches ─────────────────────────────────────────────────────────

export type BranchStates = Record<string, string>

export interface BranchTransitionDef {
  name:    string
  from:    string | string[]
  to:      string
  label?:  string
  guards?: Guard[]
}

export interface BranchStateDef {
  name:   string
  type:   StateType
  label?: string
}

export interface BranchDef {
  name:        string
  initial:     string
  states:      BranchStateDef[]
  transitions: BranchTransitionDef[]
}

export type BranchTransitionResult =
  | { ok: true;  branchStates: BranchStates; merged: true;  mergeTransition: string }
  | { ok: true;  branchStates: BranchStates; merged: false }
  | { ok: false; reason: 'invalid_transition' | 'guard_failed'; message: string }

// ── State & transition definitions ───────────────────────────────────────────

export interface StateDef {
  name:             string
  type:             StateType
  label?:           string
  meta?:            Record<string, unknown>
  onEnter?:         (ctx: SideEffectContext) => void | Promise<void>
  /** 4.6 — seconds before onTimeout transition fires */
  ttl?:             number
  onTimeout?:       string
  /** 4.7 — parallel branches active while in this state */
  branches?:        BranchDef[]
  mergeWhen?:       'all' | 'any'
  mergeTransition?: string
}

export interface TransitionDef {
  name:         string
  from:         string | string[]
  to:           string
  label?:       string
  guards?:      Guard[]
  assignTo?:    (ctx: SideEffectContext) => number | null | Promise<number | null>
  onTransition?: (ctx: SideEffectContext) => void | Promise<void>
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
  | { ok: true;  newState: string; assignTo?: number | null }
  | { ok: false; reason: 'invalid_transition'; message: string }
  | { ok: false; reason: 'guard_failed';       message: string }
  | { ok: false; reason: 'side_effect_error';  message: string }

export interface WorkflowInstance {
  readonly name:    string
  readonly initial: string
  getState(name: string): StateDef | undefined
  getTransition(name: string): TransitionDef | undefined
  availableTransitions(currentState: string, ctx?: WorkflowContext): Promise<TransitionDef[]>
  canTransition(name: string, currentState: string, ctx?: WorkflowContext): Promise<boolean>
  transition(name: string, currentState: string, ctx?: WorkflowContext): Promise<TransitionResult>
  toGraph(): { states: Omit<StateDef, 'onEnter'>[]; transitions: Omit<TransitionDef, 'guards' | 'onTransition'>[] }
  /** 4.7 — initialize branch states when entering a state that has branches */
  initBranchStates(stateName: string): BranchStates | null
  /** 4.7 — fire a transition on a single branch */
  transitionBranch(branchName: string, action: string, branchStates: BranchStates, ctx?: WorkflowContext): Promise<BranchTransitionResult>
  /** 4.7 — list available transitions for a branch */
  availableBranchTransitions(branchName: string, branchStates: BranchStates, ctx?: WorkflowContext): Promise<BranchTransitionDef[]>
}
