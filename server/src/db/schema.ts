import { pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core'

// Example schema — extend with your own tables
export const companies = pgTable('companies', {
  id:         serial('id').primaryKey(),
  name:       varchar('name', { length: 100 }).notNull(),
  nip:        varchar('nip',  { length: 20 }).unique(),
  city:       varchar('city', { length: 100 }),
  street:     varchar('street', { length: 200 }),
  zip_code:   varchar('zip_code', { length: 10 }),
  created_at: timestamp('created_at').defaultNow().notNull(),
})
