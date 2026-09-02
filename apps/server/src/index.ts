import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildApp } from './app.js'
import { ControlCenterService } from './control-center.js'

const envFile = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '..', '..', '.env')]
  .find((candidate) => existsSync(candidate))
if (envFile) process.loadEnvFile(envFile)

const port = Number(process.env.PORT ?? 4100)
const host = process.env.HOST ?? '0.0.0.0'
const service = new ControlCenterService()
await service.resumeSessions()
const app = buildApp(service)

try {
  await app.listen({ port, host })
  console.log(`[cloud-wa] control API listening on http://${host}:${port}`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
