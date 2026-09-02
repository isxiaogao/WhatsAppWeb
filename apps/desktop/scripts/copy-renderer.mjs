import { cp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopDirectory = path.resolve(scriptDirectory, '..')
const sourceDirectory = path.resolve(desktopDirectory, '..', 'web', 'dist')
const destinationDirectory = path.resolve(desktopDirectory, 'renderer')

try {
  await stat(sourceDirectory)
} catch {
  throw new Error('未找到 apps/web/dist。请先运行 npm run build -w @cloud-wa/web。')
}

await rm(destinationDirectory, { recursive: true, force: true })
await mkdir(destinationDirectory, { recursive: true })
await cp(sourceDirectory, destinationDirectory, { recursive: true })
