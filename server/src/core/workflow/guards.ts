import type { Guard, WorkflowContext } from './types.js'

export function requireRole(...roles: string[]): Guard {
  return {
    check:   (ctx: WorkflowContext) => !!ctx.user && roles.includes(ctx.user.role),
    message: `Requires role: ${roles.join(' or ')}`,
  }
}

export function requirePermission(...permissions: string[]): Guard {
  return {
    check: (ctx: WorkflowContext) => {
      if (!ctx.user) return false
      const userPerms = ctx.user['permissions'] as string[] | undefined
      return Array.isArray(userPerms) && permissions.every(p => userPerms.includes(p))
    },
    message: `Requires permission: ${permissions.join(', ')}`,
  }
}
