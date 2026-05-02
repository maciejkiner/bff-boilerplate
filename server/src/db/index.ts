import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

const client = postgres(process.env['DATABASE_URL']!, {
  max:             20,   // max connections in pool
  idle_timeout:    30,   // close idle connections after 30s
  connect_timeout: 10,   // fail fast if DB unreachable
})
export const db = drizzle(client, { schema })
export type Db = typeof db
