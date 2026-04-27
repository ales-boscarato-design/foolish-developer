import express from 'express'
import payload from 'payload'
import next from 'next'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const dev = process.env.NODE_ENV !== 'production'
const nextApp = next({ dev, dir: __dirname })
const nextHandler = nextApp.getRequestHandler()

const start = async () => {
  await payload.init({
    secret: process.env.PAYLOAD_SECRET!,
    express: app,
    onInit: () => {
      payload.logger.info(`Payload Admin URL: ${payload.getAdminURL()}`)
    },
  })

  // Prepare Next.js
  await nextApp.prepare()

  // All other routes should be handled by Next.js
  app.all('*', (req, res) => {
    return nextHandler(req, res)
  })

  app.listen(process.env.PORT || 3001, () => {
    payload.logger.info(`CMS running on port ${process.env.PORT || 3001}`)
  })
}

start()