#!/usr/bin/env tsx
/**
 * Code generation CLI.
 *
 * Usage:
 *   npx tsx scripts/generate.ts resource <Name>   — scaffold a CRUD resource
 *   npx tsx scripts/generate.ts init              — create .env from .env.example
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir    = dirname(fileURLToPath(import.meta.url))
const ROOT     = resolve(__dir, '..')
const SRC      = resolve(ROOT, 'src')
const REPO_ROOT = resolve(ROOT, '..')

// ── helpers ───────────────────────────────────────────────────────────────────

function pascal(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function camel(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function snake(s: string) {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    console.error(`  skip  ${path}  (already exists)`)
    return
  }
  writeFileSync(path, content, 'utf8')
  console.log(`  write ${path}`)
}

// ── resource generator ────────────────────────────────────────────────────────

function generateResource(name: string) {
  const Name   = pascal(name)
  const lower  = camel(name)
  const table  = snake(name) + 's'
  const dir    = resolve(SRC, 'resources', lower)

  // 1. schema snippet (printed, not auto-injected)
  const schemaSnippet = `
// Add to src/db/schema.ts:
export const ${table} = pgTable('${table}', {
  id:         serial('id').primaryKey(),
  name:       varchar('name', { length: 200 }).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})
`.trim()

  // 2. model.ts
  write(resolve(dir, 'model.ts'), `import { ${table} } from '../../db/schema.js'
import { ModelBase } from '../../core/model/ModelBase.js'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

export type ${Name}       = InferSelectModel<typeof ${table}>
export type ${Name}Insert = InferInsertModel<typeof ${table}>

export class ${Name}Model extends ModelBase<typeof ${table}, ${Name}Insert, ${Name}> {
  readonly table = ${table}
}
`)

  // 3. form.ts
  write(resolve(dir, 'form.ts'), `import { defineForm, text } from '../../core/form/index.js'
import type { ${Name}Insert } from './model.js'

export const ${lower}Form = defineForm<${Name}Insert>([
  text<${Name}Insert>('name', {
    label:      'Name',
    required:   true,
    maxLength:  200,
    filterable: true,
    sortable:   true,
  }),
])
`)

  // 4. resource.ts
  write(resolve(dir, 'resource.ts'), `import { BaseCrud } from '../../core/crud/BaseCrud.js'
import { ${Name}Model, type ${Name}, type ${Name}Insert } from './model.js'
import { ${lower}Form } from './form.js'
import { ${table} } from '../../db/schema.js'

export class ${Name}Resource extends BaseCrud<typeof ${table}, ${Name}Insert, ${Name}> {
  readonly model = new ${Name}Model()
  readonly form  = ${lower}Form
}
`)

  // 5. print registration instructions
  console.log(`
Done! Next steps:

1. Add the schema snippet to src/db/schema.ts:

${schemaSnippet}

2. Register the resource in src/index.ts:

   import { ${Name}Resource } from './resources/${lower}/resource.js'
   // inside registry chain:
   .register('${table}', ${Name}Resource)

3. Push schema to DB:
   npm run db:push
`)
}

// ── init ──────────────────────────────────────────────────────────────────────

function init() {
  const example = resolve(REPO_ROOT, '.env.example')
  const target  = resolve(REPO_ROOT, '.env')

  if (!existsSync(example)) {
    console.error('.env.example not found at repo root')
    process.exit(1)
  }

  if (existsSync(target)) {
    console.log('.env already exists — skipping')
    return
  }

  copyFileSync(example, target)
  console.log('Created .env from .env.example')
  console.log('Update DATABASE_URL and JWT_SECRET before starting the server.')
}

// ── main ──────────────────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv

switch (command) {
  case 'resource': {
    const name = args[0]
    if (!name) { console.error('Usage: generate resource <Name>'); process.exit(1) }
    generateResource(name)
    break
  }
  case 'init': {
    init()
    break
  }
  default: {
    console.log(`Usage:
  npx tsx scripts/generate.ts resource <Name>   scaffold a CRUD resource
  npx tsx scripts/generate.ts init              create .env from .env.example`)
  }
}
