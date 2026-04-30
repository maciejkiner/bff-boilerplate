import type { PagedMeta } from '../crud/listQuery.js'

export type ApiResponse<T> =
  | { ok: true;  data: T }
  | { ok: true;  data: T; meta: PagedMeta }
  | { ok: false; errors: Record<string, string[]> }

export const ok      = <T>(data: T): ApiResponse<T>                          => ({ ok: true, data })
export const okPaged = <T>(data: T, meta: PagedMeta): ApiResponse<T>         => ({ ok: true, data, meta })
export const fail    = (errors: Record<string, string[]>): ApiResponse<never> => ({ ok: false, errors })
