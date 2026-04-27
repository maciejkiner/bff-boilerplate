export type ApiResponse<T> =
  | { ok: true;  data: T }
  | { ok: false; errors: Record<string, string[]> }

export const ok  = <T>(data: T): ApiResponse<T>                          => ({ ok: true, data })
export const fail = (errors: Record<string, string[]>): ApiResponse<never> => ({ ok: false, errors })
