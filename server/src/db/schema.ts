import { index, integer, jsonb, pgTable, serial, varchar, timestamp, boolean } from 'drizzle-orm/pg-core'

// <!-- generate:schema --> — marker used by `npm run generate resource`; do not remove
export const users = pgTable('users', {
  id:         serial('id').primaryKey(),
  email:      varchar('email', { length: 200 }).notNull().unique(),
  name:       varchar('name',  { length: 100 }).notNull(),
  role:       varchar('role',  { length: 50  }).notNull().default('user'),
  active:     boolean('active').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const audit_events = pgTable('audit_events', {
  id:          serial('id').primaryKey(),
  entity_type: varchar('entity_type', { length: 100 }).notNull(),
  entity_id:   integer('entity_id').notNull(),
  action:      varchar('action',      { length: 50  }).notNull(),
  user_id:     integer('user_id'),
  payload:     jsonb('payload'),
  timestamp:   timestamp('timestamp').defaultNow().notNull(),
}, t => [
  index('audit_entity_idx').on(t.entity_type, t.entity_id),
  index('audit_timestamp_idx').on(t.timestamp),
])

export const form_submission_versions = pgTable('form_submission_versions', {
  id:            serial('id').primaryKey(),
  submission_id: integer('submission_id').notNull(),
  version:       integer('version').notNull(),
  data:          jsonb('data').notNull(),
  changed_by:    integer('changed_by'),
  changed_at:    timestamp('changed_at').defaultNow().notNull(),
}, t => [
  index('fsv_submission_idx').on(t.submission_id),
])

export const form_submissions = pgTable('form_submissions', {
  id:         serial('id').primaryKey(),
  form_name:  varchar('form_name',  { length: 100 }).notNull(),
  status:     varchar('status',     { length: 20  }).notNull().default('draft'),
  data:       jsonb('data').notNull().default({}),
  created_by:     integer('created_by'),
  assigned_to:    integer('assigned_to'),
  current_step:   varchar('current_step',   { length: 100 }),
  workflow_state:            varchar('workflow_state',            { length: 100 }),
  workflow_state_entered_at: timestamp('workflow_state_entered_at'),
  workflow_branches:         jsonb('workflow_branches'),
  created_at:   timestamp('created_at').defaultNow().notNull(),
  updated_at:   timestamp('updated_at').defaultNow().notNull(),
  deleted_at:   timestamp('deleted_at'),
  version:      integer('version').notNull().default(1),
}, t => [
  index('fs_form_deleted_idx').on(t.form_name, t.deleted_at),
  index('fs_ttl_idx').on(t.workflow_state_entered_at),
  index('fs_assigned_idx').on(t.assigned_to),
])
