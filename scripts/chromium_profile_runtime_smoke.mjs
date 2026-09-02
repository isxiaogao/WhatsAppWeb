import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { BrowserProfileStore } from '../apps/desktop/dist/browser-profile-store.js'
import { ChromiumRuntime } from '../apps/desktop/dist/chromium-runtime.js'

const timeout = setTimeout(() => {
  console.error('Chromium Profile Runtime smoke test timed out.')
  process.exitCode = 1
}, 45_000)

const directory = await mkdtemp(path.join(os.tmpdir(), 'wa-chromium-runtime-smoke-'))
const runtime = new ChromiumRuntime()
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><title>WA Runtime Smoke</title><h1>ready</h1>')
})

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object')
  const store = new BrowserProfileStore(directory)
  const created = await store.create({
    name: 'Chromium Runtime Smoke',
    owner: '自动测试',
    purpose: '验证真实 Chromium Profile Runtime',
    browser: 'chrome',
    proxyUrl: '',
    proxyUsername: '',
    proxyPassword: '',
    clearProxyPassword: false,
    startUrl: `http://127.0.0.1:${address.port}/`,
    timezone: 'Pacific/Honolulu',
    locale: 'en-US',
    fingerprintMode: 'enhanced',
  })
  const runtimeProfile = await store.runtimeProfile(created.id)
  const started = await runtime.start(runtimeProfile, store.profileDataDirectory(created.id))
  assert.equal(started.status, 'RUNNING')
  assert.ok(started.cdpEndpoint)

  const targetsResponse = await fetch(`${started.cdpEndpoint}/json/list`)
  assert.equal(targetsResponse.ok, true)
  const targets = await targetsResponse.json()
  const pageTarget = targets.find((target) => target.type === 'page' && target.url === runtimeProfile.startUrl)
  assert.ok(pageTarget?.webSocketDebuggerUrl)
  const evaluated = await evaluate(pageTarget.webSocketDebuggerUrl, `({
    title: document.title,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screen: screen.width + 'x' + screen.height,
    webdriver: navigator.webdriver,
  })`)

  assert.equal(evaluated.title, 'WA Runtime Smoke')
  assert.equal(evaluated.timezone, 'Pacific/Honolulu')
  assert.equal(evaluated.language, runtimeProfile.fingerprint.fingerprint.navigator.language)
  assert.equal(evaluated.userAgent, runtimeProfile.fingerprint.fingerprint.navigator.userAgent)
  assert.equal(evaluated.platform, runtimeProfile.fingerprint.fingerprint.navigator.platform)
  assert.equal(
    evaluated.screen,
    `${runtimeProfile.fingerprint.fingerprint.screen.width}x${runtimeProfile.fingerprint.fingerprint.screen.height}`,
  )
  assert.notEqual(evaluated.webdriver, true)

  const stopped = await runtime.stop(created.id)
  assert.equal(stopped.status, 'STOPPED')
  console.log('Chromium Profile Runtime smoke passed:', JSON.stringify({ started, evaluated }))
} finally {
  clearTimeout(timeout)
  await runtime.shutdown()
  await new Promise((resolve) => server.close(resolve))
  const resolved = path.resolve(directory)
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`
  if (!resolved.startsWith(temporaryRoot)) throw new Error('Refusing to clean outside the temporary directory')
  await rm(resolved, { recursive: true, force: true })
}

async function evaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 5_000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('CDP connection failed'))
    }, { once: true })
  })
  try {
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }))
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP evaluation timed out')), 5_000)
      socket.addEventListener('message', async (event) => {
        const text = typeof event.data === 'string' ? event.data : await event.data.text()
        const message = JSON.parse(text)
        if (message.id !== 1) return
        clearTimeout(timer)
        resolve(message)
      })
    })
    if (response.error) throw new Error(response.error.message)
    if (response.result?.exceptionDetails) throw new Error('CDP evaluation raised an exception')
    return response.result.result.value
  } finally {
    socket.close()
  }
}
