import type {
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
      try {
        if (t.onTransition) await t.onTransition(seCtx)
        const newStateDef = stateMap.get(t.to)
        if (newStateDef?.onEnter) await newStateDef.onEnter(seCtx)
      } catch (err) {
        return { ok: false, reason: 'side_effect_error',
          message: err instanceof Error ? err.message : 'Side effect failed' }
      }

      return { ok: true, newState: t.to }
    },

    toGraph() {
      return {
        states:      def.states.map(({ onEnter: _e, ...rest }) => rest),
        transitions: def.transitions.map(({ guards: _g, onTransition: _t, ...rest }) => rest),
      }
    },
  }
}
