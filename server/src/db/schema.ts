import { integer, jsonb, pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core'

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

export const form_submissions = pgTable('form_submissions', {
  id:         serial('id').primaryKey(),
  form_name:  varchar('form_name',  { length: 100 }).notNull(),
  status:     varchar('status',     { length: 20  }).notNull().default('draft'),
  data:       jsonb('data').notNull().default({}),
  created_by: integer('created_by'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
  version:    integer('version').notNull().default(1),
})
