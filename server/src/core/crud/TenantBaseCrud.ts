import type { Context } from 'hono'
import type { PgTableWithColumns } from 'drizzle-orm/pg-core'
import type { ModelBase } from '../model/ModelBase.js'
import type { FormDefinition } from '../form/types.js'
import type { AuthUser } from '../../middleware/auth.js'
import { BaseCrud } from './BaseCrud.js'
import { fail } from '../routing/response.js'

/**
 * BaseCrud variant that auto-scopes all list queries to the current user's tenant.
 *
 * Usage:
 *   1. Extend TenantBaseCrud instead of BaseCrud.
 *   2. Set `tenantField` to the DB column that holds the tenant FK (e.g. `'org_id'`).
 *   3. The tenant ID is extracted from `ctx.get('user')[tenantIdClaim]`.
 *      Override `getTenantId()` for custom claim paths.
 *
 * All CRUD operations are restricted to rows matching the caller's tenant.
 * Attempts to access rows belonging to other tenants return 403.
 */
export abstract class TenantBaseCrud<
  TTable extends PgTableWithColumns<any>,
  TInput extends Record<string, unknown>,
  TSelect extends { id: number },
> extends BaseCrud<TTable, TInput, TSelect> {
  abstract override readonly model: ModelBase<TTable, TInput, TSelect>
  abstract override readonly form:  FormDefinition<TInput>

  /** Column name on the table that stores the tenant FK. */
  protected abstract readonly tenantField: string

  /**
   * Claim key to read from AuthUser for the tenant ID.
   * Default: `'tenant_id'` (must be in the JWT via claimsMap or extra payload).
   */
  protected readonly tenantIdClaim: string = 'tenant_id'

  /** Extract the tenant ID from the authenticated user. Override for custom claim structures. */
  protected getTenantId(ctx: Context): number | string | null {
    const user = this.getUser(ctx) as (AuthUser & Record<string, unknown>) | undefined
    if (!user) return null
    const tid = user[this.tenantIdClaim]
    if (typeof tid === 'number' || typeof tid === 'string') return tid
    return null
  }

  /** Inject a tenant-scope filter and guard the context before every list call. */
  override async list(ctx: Context): Promise<Response> {
    const tenantId = this.getTenantId(ctx)
    if (tenantId === null) return ctx.json(fail({ _root: ['Tenant identity missing'] }), 403)
    ctx.set('__tenantFilter', { field: this.tenantField, op: 'eq', value: String(tenantId) })
    return super.list(ctx)
  }

  /** Inject tenant filter for get — BaseCrud fetches by id, then we verify ownership. */
  override async get(ctx: Context): Promise<Response> {
    const tenantId = this.getTenantId(ctx)
    if (tenantId === null) return ctx.json(fail({ _root: ['Tenant identity missing'] }), 403)
    const res = await super.get(ctx)
    // If 200, verify the returned row belongs to this tenant
    if (res.status === 200) {
      const body = await res.clone().json() as { data?: Record<string, unknown> }
      const row  = body?.data
      if (row && String(row[this.tenantField]) !== String(tenantId)) {
        return ctx.json(fail({ _root: ['Forbidden'] }), 403)
      }
    }
    return res
  }

  /** Stamp tenant ID onto the input so new records are always owned by the caller's tenant. */
  override async create(ctx: Context): Promise<Response> {
    const tenantId = this.getTenantId(ctx)
    if (tenantId === null) return ctx.json(fail({ _root: ['Tenant identity missing'] }), 403)
    // Inject the tenant FK into the body before BaseCrud processes it
    const original = ctx.req.json.bind(ctx.req)
    ctx.req.json = async () => {
      const body = await original()
      return typeof body === 'object' && body !== null
        ? { ...(body as object), [this.tenantField]: tenantId }
        : body
    }
    return super.create(ctx)
  }

  /** Guard update: fetch row first to confirm tenant ownership. */
  override async update(ctx: Context): Promise<Response> {
    if (!await this.assertTenantOwnership(ctx)) return ctx.json(fail({ _root: ['Forbidden'] }), 403)
    return super.update(ctx)
  }

  override async partialUpdate(ctx: Context): Promise<Response> {
    if (!await this.assertTenantOwnership(ctx)) return ctx.json(fail({ _root: ['Forbidden'] }), 403)
    return super.partialUpdate(ctx)
  }

  override async delete(ctx: Context): Promise<Response> {
    if (!await this.assertTenantOwnership(ctx)) return ctx.json(fail({ _root: ['Forbidden'] }), 403)
    return super.delete(ctx)
  }

  private async assertTenantOwnership(ctx: Context): Promise<boolean> {
    const tenantId = this.getTenantId(ctx)
    if (tenantId === null) return false
    const id = Number(ctx.req.param('id'))
    if (!id) return false
    const row = await this.model.get(id) as Record<string, unknown> | undefined
    if (!row) return true // let BaseCrud return 404
    return String(row[this.tenantField]) === String(tenantId)
  }
}
