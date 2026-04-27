import type { ErrorHandler } from 'hono'
import { fail } from '../core/routing/index.js'

export const errorHandler: ErrorHandler = (err, ctx) => {
  console.error(err)
  return ctx.json(fail({ _root: ['Internal server error'] }), 500)
}
