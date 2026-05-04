import type { AuthUser } from '../../middleware/auth.js'

export abstract class AuthPolicy<TRecord extends Record<string, unknown> = Record<string, unknown>> {
  canList   (_user: AuthUser | undefined):                    boolean { return true }
  canRead   (_user: AuthUser | undefined, _record: TRecord):  boolean { return true }
  canCreate (_user: AuthUser | undefined):                    boolean { return true }
  canUpdate (_user: AuthUser | undefined, _record: TRecord):  boolean { return true }
  canDelete (_user: AuthUser | undefined, _record: TRecord):  boolean { return true }
}

/** Allow only users with one of the specified roles. */
export class RolePolicy<T extends Record<string, unknown>> extends AuthPolicy<T> {
  constructor(private readonly roles: string[]) { super() }
  private allow(user: AuthUser | undefined) { return !!user && this.roles.includes(user.role) }
  override canList   (user: AuthUser | undefined)          { return this.allow(user) }
  override canCreate (user: AuthUser | undefined)          { return this.allow(user) }
  override canRead   (user: AuthUser | undefined, _: T)   { return this.allow(user) }
  override canUpdate (user: AuthUser | undefined, _: T)   { return this.allow(user) }
  override canDelete (user: AuthUser | undefined, _: T)   { return this.allow(user) }
}

/** Allow only the user who created the record (record.created_by === user.id). */
export class OwnerPolicy<T extends Record<string, unknown>> extends AuthPolicy<T> {
  override canRead   (u: AuthUser | undefined, r: T) { return !!u && r['created_by'] === u.id }
  override canUpdate (u: AuthUser | undefined, r: T) { return !!u && r['created_by'] === u.id }
  override canDelete (u: AuthUser | undefined, r: T) { return !!u && r['created_by'] === u.id }
}

/** Allows access if ANY of the provided policies passes. */
export class AnyPolicy<T extends Record<string, unknown>> extends AuthPolicy<T> {
  constructor(private readonly policies: AuthPolicy<T>[]) { super() }
  override canList   (u: AuthUser | undefined)       { return this.policies.some(p => p.canList(u)) }
  override canCreate (u: AuthUser | undefined)       { return this.policies.some(p => p.canCreate(u)) }
  override canRead   (u: AuthUser | undefined, r: T) { return this.policies.some(p => p.canRead(u, r)) }
  override canUpdate (u: AuthUser | undefined, r: T) { return this.policies.some(p => p.canUpdate(u, r)) }
  override canDelete (u: AuthUser | undefined, r: T) { return this.policies.some(p => p.canDelete(u, r)) }
}
