import { z } from 'zod'

// In test mode, DB and JWT are optional (integration tests manage their own skip logic).
const isTest = process.env['NODE_ENV'] === 'test'

const schema = z.object({
  NODE_ENV:             z.enum(['development', 'test', 'production']).default('development'),
  PORT:                 z.coerce.number().default(3000),
  DATABASE_URL:         isTest
                          ? z.string().default('')
                          : z.string().min(1),
  JWT_SECRET:           isTest
                          ? z.string().default('test-secret-placeholder-at-least-32-chars')
                          : z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ALLOWED_ORIGINS:      z.string().optional(),
  LOG_LEVEL:            z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MAX_BODY_SIZE_KB:     z.coerce.number().default(512),
  RATE_LIMIT_MAX:            z.coerce.number().default(200),
  RATE_LIMIT_WINDOW_MS:      z.coerce.number().default(60_000),
  JWT_ACCESS_EXPIRY_SECONDS:  z.coerce.number().default(15 * 60),       // 15 min
  JWT_REFRESH_EXPIRY_SECONDS: z.coerce.number().default(7 * 24 * 3600), // 7 days
}).superRefine((v, ctx) => {
  if (v.NODE_ENV === 'production' && !v.ALLOWED_ORIGINS) {
    ctx.addIssue({ code: 'custom', path: ['ALLOWED_ORIGINS'], message: 'Required in production' })
  }
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('[config] Invalid environment:')
  for (const e of parsed.error.errors) {
    console.error(`  ${e.path.join('.')}: ${e.message}`)
  }
  process.exit(1)
}

export const config = parsed.data
export type Config  = typeof config
