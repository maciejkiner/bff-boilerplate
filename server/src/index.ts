import 'dotenv/config'
import { config } from './config.js'
import { serve }  from '@hono/node-server'
import { app }    from './app.js'
import { closeDb } from './db/index.js'

const server = serve({ fetch: app.fetch, port: config.PORT })

console.log(`Server running on http://localhost:${config.PORT}`)

function shutdown(signal: string): void {
  console.log(`[shutdown] ${signal} received — draining requests…`)
  server.close(async () => {
    console.log('[shutdown] All connections closed. Closing DB pool…')
    await closeDb()
    console.log('[shutdown] Done.')
    process.exit(0)
  })
  setTimeout(() => {
    console.error('[shutdown] Forced exit after 30 s')
    process.exit(1)
  }, 30_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
