import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { validateJwtSecret } from './middleware/auth.js'

validateJwtSecret()

const port = Number(process.env['PORT'] ?? 3000)

process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT received — shutting down')
  process.exit(0)
})

console.log(`Server running on http://localhost:${port}`)
serve({ fetch: app.fetch, port })
