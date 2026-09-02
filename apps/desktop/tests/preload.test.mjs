import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopDirectory = path.resolve(testDirectory, '..')

test('builds the sandbox preload as CommonJS and loads that file from the main process', async () => {
  const [mainSource, preloadOutput] = await Promise.all([
    readFile(path.join(desktopDirectory, 'src', 'main.ts'), 'utf8'),
    readFile(path.join(desktopDirectory, 'dist', 'preload.cjs'), 'utf8'),
  ])

  assert.match(mainSource, /preload:\s*path\.join\(currentDirectory, 'preload\.cjs'\)/)
  assert.match(preloadOutput, /require\("electron"\)/)
  assert.doesNotMatch(preloadOutput, /import\s+.*from\s+['"]electron['"]/)
})
