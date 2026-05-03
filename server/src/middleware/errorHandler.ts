import type { ErrorHandler } from 'hono'
import { fail } from '../core/routing/index.js'

function pgErrorMessage(code: string): { status: 409 | 422; message: string } | null {
  switch (code) {
    case '23505': return { status: 409, message: 'A record with this value already exists' }
    case '23503': return { status: 422, message: 'Referenced record does not exist' }
    case '23502': return { status: 422, message: 'A required field is missing' }
    default:      return null
  }
}

export const errorHandler: ErrorHandler = (err, ctx) => {
  const pgCode = (err as { code?: string }).code
  if (pgCode) {
    const mapped = pgErrorMessage(pgCode)
    if (mapped) return ctx.json(fail({ _root: [mapped.message] }), mapped.status)
  }
  console.error(err)
  return ctx.json(fail({ _root: ['Internal server error'] }), 500)
}
