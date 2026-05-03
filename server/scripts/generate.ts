#!/usr/bin/env tsx
/**
 * Code generation CLI.
 *
 * Usage:
 *   npm run generate resource <Name>          scaffold a CRUD resource
 *   npm run generate resource <Name> --dry-run  preview without writing
 *   npm run generate init                     create .env from .env.example
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir     = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dir, '..')
const SRC       = resolve(ROOT, 'src')
const REPO_ROOT = resolve(ROOT, '..')

// ── helpers ───────────────────────────────────────────────────────────────────

function pascal(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
function camel(s: string)  { return s.charAt(0).toLowerCase() + s.slice(1) }
function snake(s: string)  { return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') }

const isDryRun = process.argv.includes('--dry-run')

function write(path: string, content: string) {
  if (isDryRun) {
    console.log(`  [dry-run] would write: ${path}`)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    console.error(`  skip  ${path}  (already exists)`)
    return
  }
  writeFileSync(path, content, 'utf8')
  console.log(`  write ${path}`)
}

function inject(filePath: string, marker: string, snippet: string) {
  if (!existsSync(filePath)) {
    console.error(`  warn  ${filePath} not found — skipping injection`)
    return
  }
  const src = readFileSync(filePath, 'utf8')
  if (src.includes(snippet.trim())) {
    console.log(`  skip  injection into ${filePath} (already present)`)
    return
  }
  if (!src.includes(marker)) {
    console.error(`  warn  marker '${marker}' not found in ${filePath} — skipping injection`)
    return
  }
  const updated = src.replace(marker, `${marker}\n${snippet}`)
  if (isDryRun) {
    console.log(`  [dry-run] would inject into ${filePath}:\n${snippet}`)
    return
  }
  writeFileSync(filePath, updated, 'utf8')
  console.log(`  inject ${filePath}`)
}

// ── resource generator ────────────────────────────────────────────────────────

function generateResource(name: string) {
  const Name   = pascal(name)
  const lower  = camel(name)
  const table  = snake(name) + 's'
  const dir    = resolve(SRC, 'resources', lower)

  // 1. model.ts
  write(resolve(dir, 'model.ts'), `import { ${table} } from '../../db/schema.js'
import { ModelBase } from '../../core/model/ModelBase.js'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

export type ${Name}       = InferSelectModel<typeof ${table}>
export type ${Name}Insert = InferInsertModel<typeof ${table}>

export class ${Name}Model extends ModelBase<typeof ${table}, ${Name}Insert, ${Name}> {
  readonly table = ${table}
}
`)

  // 2. form.ts
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

  // 3. resource.ts
  write(resolve(dir, 'resource.ts'), `import { BaseCrud } from '../../core/crud/BaseCrud.js'
import { ${Name}Model, type ${Name}, type ${Name}Insert } from './model.js'
import { ${lower}Form } from './form.js'
import { ${table} } from '../../db/schema.js'

export class ${Name}Resource extends BaseCrud<typeof ${table}, ${Name}Insert, ${Name}> {
  readonly model = new ${Name}Model()
  readonly form  = ${lower}Form
}
`)

  // 4. inject schema table definition into db/schema.ts
  const schemaSnippet = `export const ${table} = pgTable('${table}', {
  id:         serial('id').primaryKey(),
  name:       varchar('name', { length: 200 }).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})
`
  inject(resolve(SRC, 'db', 'schema.ts'), '// <!-- generate:schema -->', schemaSnippet)

  // 5. inject resource registration into app.ts
  const importLine  = `import { ${Name}Resource } from './resources/${lower}/resource.js'`
  const registerLine = `  .register('${table}', ${Name}Resource)`

  inject(resolve(SRC, 'app.ts'), '// <!-- generate:resources -->', importLine)
  inject(resolve(SRC, 'app.ts'), '  // <!-- generate:registry -->', registerLine)

  console.log(`
Done! Next step: push schema to DB:
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

  if (isDryRun) {
    console.log('[dry-run] would copy .env.example → .env')
    return
  }

  copyFileSync(example, target)
  console.log('Created .env from .env.example')
  console.log('Update DATABASE_URL and JWT_SECRET before starting the server.')
}

// ── main ──────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2).filter(a => a !== '--dry-run')
const [command, ...rest] = args

switch (command) {
  case 'resource': {
    const name = rest[0]
    if (!name) { console.error('Usage: npm run generate resource <Name>'); process.exit(1) }
    generateResource(name)
    break
  }
  case 'init': {
    init()
    break
  }
  default: {
    console.log(`Usage:
  npm run generate resource <Name>            scaffold a CRUD resource (auto-injects schema + route)
  npm run generate resource <Name> --dry-run  preview without writing files
  npm run generate init                       create .env from .env.example`)
  }
}
