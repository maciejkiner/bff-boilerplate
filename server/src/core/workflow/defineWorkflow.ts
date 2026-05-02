import type {
  BranchDef, BranchStates, BranchTransitionResult,
  Guard, SideEffectContext, StateDef, TransitionDef, TransitionResult,
  WorkflowContext, WorkflowDef, WorkflowInstance,
} from './types.js'

export function defineWorkflow(def: WorkflowDef): WorkflowInstance {
  const stateNames = new Set(def.states.map(s => s.name))
  if (!stateNames.has(def.initial)) {
    throw new Error(`Workflow '${def.name}': initial state '${def.initial}' is not defined`)
  }
  for (const t of def.transitions) {
    const froms = Array.isArray(t.from) ? t.from : [t.from]
    for (const f of froms) {
      if (!stateNames.has(f))
        throw new Error(`Workflow '${def.name}': transition '${t.name}' references unknown state '${f}'`)
    }
    if (!stateNames.has(t.to))
      throw new Error(`Workflow '${def.name}': transition '${t.name}' references unknown state '${t.to}'`)
  }

  const stateMap      = new Map(def.states.map(s => [s.name, s]))
  const transitionMap = new Map(def.transitions.map(t => [t.name, t]))

  async function runGuards(guards: Guard[], ctx: WorkflowContext): Promise<{ passed: boolean; message: string }> {
    for (const guard of guards) {
      const passed = await guard.check(ctx)
      if (!passed) return { passed: false, message: guard.message ?? 'Guard condition not met' }
    }
    return { passed: true, message: '' }
  }

  function fromMatches(t: TransitionDef, currentState: string): boolean {
    const froms = Array.isArray(t.from) ? t.from : [t.from]
    return froms.includes(currentState)
  }

  return {
    name:    def.name,
    initial: def.initial,

    getState:      (name) => stateMap.get(name),
    getTransition: (name) => transitionMap.get(name),

    async availableTransitions(currentState, ctx = {}) {
      const matching  = def.transitions.filter(t => fromMatches(t, currentState))
      const available: TransitionDef[] = []
      for (const t of matching) {
        if (!t.guards?.length) { available.push(t); continue }
        const { passed } = await runGuards(t.guards, ctx)
        if (passed) available.push(t)
      }
      return available
    },

    async canTransition(name, currentState, ctx = {}) {
      const t = transitionMap.get(name)
      if (!t || !fromMatches(t, currentState)) return false
      if (!t.guards?.length) return true
      const { passed } = await runGuards(t.guards, ctx)
      return passed
    },

    async transition(name, currentState, ctx = {}): Promise<TransitionResult> {
      const t = transitionMap.get(name)
      if (!t || !fromMatches(t, currentState)) {
        return { ok: false, reason: 'invalid_transition',
          message: `Transition '${name}' is not valid from state '${currentState}'` }
      }
      if (t.guards?.length) {
        const { passed, message } = await runGuards(t.guards, ctx)
        if (!passed) return { ok: false, reason: 'guard_failed', message }
      }

      // Run side effects: onTransition → onEnter(new state)
      // Order: guard ✓ → transition confirmed → effects
      const seCtx: SideEffectContext = { ...ctx, transition: name, fromState: currentState, toState: t.to }
      let assignTo: number | null | undefined
      try {
        if (t.assignTo) assignTo = await t.assignTo(seCtx)
        if (t.onTransition) await t.onTransition(seCtx)
        const newStateDef = stateMap.get(t.to)
        if (newStateDef?.onEnter) await newStateDef.onEnter(seCtx)
      } catch (err) {
        return { ok: false, reason: 'side_effect_error',
          message: err instanceof Error ? err.message : 'Side effect failed' }
      }

      return { ok: true, newState: t.to, ...(assignTo !== undefined ? { assignTo } : {}) }
    },

    toGraph() {
      return {
        states: def.states.map(({ onEnter: _e, branches, ...rest }) => ({
          ...rest,
          ...(branches?.length ? {
            branches: branches.map(b => ({
              name:        b.name,
              initial:     b.initial,
              states:      b.states,
              transitions: b.transitions.map(({ guards: _g, ...tr }) => tr),
            })),
          } : {}),
        })),
        transitions: def.transitions.map(({ guards: _g, onTransition: _t, ...rest }) => rest),
      }
    },

    // ── 4.7 Parallel branches ─────────────────────────────────────────────────

    initBranchStates(stateName: string): BranchStates | null {
      const state = stateMap.get(stateName)
      if (!state?.branches?.length) return null
      return Object.fromEntries(state.branches.map(b => [b.name, b.initial]))
    },

    async transitionBranch(
      branchName: string,
      action:     string,
      branchStates: BranchStates,
      ctx:        WorkflowContext = {},
    ): Promise<BranchTransitionResult> {
      // Find which main state owns this branch (look at the current main workflow state is unknown here;
      // we search all states for a branch with this name)
      let branch: BranchDef | undefined
      let ownerState: StateDef | undefined
      for (const s of def.states) {
        const found = s.branches?.find(b => b.name === branchName)
        if (found) { branch = found; ownerState = s; break }
      }
      if (!branch || !ownerState) {
        return { ok: false, reason: 'invalid_transition', message: `Branch '${branchName}' not found` }
      }

      const currentBranchState = branchStates[branchName]
      if (!currentBranchState) {
        return { ok: false, reason: 'invalid_transition', message: `Branch '${branchName}' has no current state` }
      }

      const froms   = (t: { from: string | string[] }) => Array.isArray(t.from) ? t.from : [t.from]
      const t = branch.transitions.find(tr => tr.name === action && froms(tr).includes(currentBranchState))
      if (!t) {
        return { ok: false, reason: 'invalid_transition',
          message: `Transition '${action}' is not valid from branch state '${currentBranchState}'` }
      }

      if (t.guards?.length) {
        const { passed, message } = await runGuards(t.guards, ctx)
        if (!passed) return { ok: false, reason: 'guard_failed', message }
      }

      const updated: BranchStates = { ...branchStates, [branchName]: t.to }

      // Check merge condition
      if (ownerState.mergeTransition) {
        const mergeWhen = ownerState.mergeWhen ?? 'all'
        const branchFinals = new Map(ownerState.branches!.map(b => [b.name, new Set(b.states.filter(s => s.type === 'final').map(s => s.name))]))
        const isInFinal = (bName: string, bState: string) => branchFinals.get(bName)?.has(bState) ?? false
        const allBranches = ownerState.branches!.map(b => b.name)
        const inFinal     = allBranches.filter(b => isInFinal(b, updated[b] ?? ''))
        const shouldMerge = mergeWhen === 'all'
          ? inFinal.length === allBranches.length
          : inFinal.length >= 1
        if (shouldMerge) {
          return { ok: true, branchStates: updated, merged: true, mergeTransition: ownerState.mergeTransition }
        }
      }

      return { ok: true, branchStates: updated, merged: false }
    },

    async availableBranchTransitions(
      branchName:   string,
      branchStates: BranchStates,
      ctx:          WorkflowContext = {},
    ) {
      let branch: BranchDef | undefined
      for (const s of def.states) {
        const found = s.branches?.find(b => b.name === branchName)
        if (found) { branch = found; break }
      }
      if (!branch) return []
      const current = branchStates[branchName]
      if (!current) return []
      const froms = (t: { from: string | string[] }) => Array.isArray(t.from) ? t.from : [t.from]
      const matching = branch.transitions.filter(t => froms(t).includes(current))
      const available = []
      for (const t of matching) {
        if (!t.guards?.length) { available.push(t); continue }
        const { passed } = await runGuards(t.guards, ctx)
        if (passed) available.push(t)
      }
      return available
    },
  }
}
