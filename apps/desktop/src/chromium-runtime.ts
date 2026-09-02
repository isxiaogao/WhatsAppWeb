import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { FingerprintInjector } from 'fingerprint-injector'
import { chromium, type BrowserContext } from 'patchright'
import { resolveBrowserExecutable, type BrowserRuntimeProfile } from './browser-profile-store.js'

export type BrowserRuntimeStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'CRASHED'

export interface BrowserRuntimeSnapshot {
  status: BrowserRuntimeStatus
  cdpEndpoint: string | null
  startedAt: string | null
  lastError: string | null
}

interface RuntimeSession extends BrowserRuntimeSnapshot {
  context: BrowserContext | null
}

const CDP_TIMEOUT_MS = 8_000

export class ChromiumRuntime {
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly injector = new FingerprintInjector()

  status(profileId: string): BrowserRuntimeSnapshot {
    return snapshotOf(this.sessions.get(profileId))
  }

  async start(profile: BrowserRuntimeProfile, userDataDirectory: string): Promise<BrowserRuntimeSnapshot> {
    const existing = this.sessions.get(profile.id)
    if (existing?.status === 'RUNNING' && existing.context) {
      const page = existing.context.pages()[0]
      if (page) await page.bringToFront()
      return snapshotOf(existing)
    }
    if (existing?.status === 'STARTING' || existing?.status === 'STOPPING') {
      throw new Error('浏览器档案正在切换状态，请稍后重试')
    }

    const session: RuntimeSession = {
      status: 'STARTING',
      context: null,
      cdpEndpoint: null,
      startedAt: null,
      lastError: null,
    }
    this.sessions.set(profile.id, session)

    try {
      const executablePath = await resolveBrowserExecutable(profile.browser)
      if (!executablePath) {
        throw new Error(profile.browser === 'chrome' ? '未检测到 Google Chrome' : '未检测到 Microsoft Edge')
      }
      const generated = profile.fingerprint.fingerprint
      const context = await chromium.launchPersistentContext(userDataDirectory, {
        executablePath,
        headless: false,
        chromiumSandbox: true,
        viewport:
          profile.fingerprintMode === 'enhanced'
            ? { width: generated.screen.width, height: generated.screen.height }
            : null,
        ...(profile.fingerprintMode === 'enhanced'
          ? {
              screen: { width: generated.screen.width, height: generated.screen.height },
              deviceScaleFactor: generated.screen.devicePixelRatio,
              userAgent: generated.navigator.userAgent,
            }
          : {}),
        locale: profile.locale,
        timezoneId: profile.timezone,
        ...(profile.proxyUrl
          ? { proxy: {
              server: profile.proxyUrl,
              ...(profile.proxyUsername ? { username: profile.proxyUsername } : {}),
              ...(profile.proxyPassword ? { password: profile.proxyPassword } : {}),
            } }
          : {}),
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port=0',
        ],
      })
      session.context = context
      context.on('close', () => {
        const current = this.sessions.get(profile.id)
        if (!current || current.context !== context) return
        current.context = null
        current.cdpEndpoint = null
        current.status = current.status === 'STOPPING' ? 'STOPPED' : 'CRASHED'
        if (current.status === 'CRASHED' && !current.lastError) current.lastError = '浏览器进程意外退出'
      })

      if (profile.fingerprintMode === 'enhanced') {
        await context.addInitScript({ content: this.injector.getInjectableScript(profile.fingerprint) })
        await context.setExtraHTTPHeaders(injectableHeaders(profile.fingerprint.headers))
      }

      const page = context.pages()[0] ?? (await context.newPage())
      await page.goto(profile.startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      session.status = 'RUNNING'
      session.cdpEndpoint = await readCdpEndpoint(userDataDirectory)
      session.startedAt = new Date().toISOString()
      return snapshotOf(session)
    } catch (error) {
      if (session.context) await session.context.close().catch(() => undefined)
      session.context = null
      session.status = 'CRASHED'
      session.cdpEndpoint = null
      session.lastError = messageFor(error)
      throw new Error(`浏览器启动失败：${session.lastError}`, { cause: error })
    }
  }

  async stop(profileId: string): Promise<BrowserRuntimeSnapshot> {
    const session = this.sessions.get(profileId)
    if (!session || session.status === 'STOPPED') return stoppedSnapshot()
    if (session.status === 'STARTING') throw new Error('浏览器档案正在启动，请稍后重试')
    session.status = 'STOPPING'
    try {
      if (session.context) await session.context.close()
      session.context = null
      session.status = 'STOPPED'
      session.cdpEndpoint = null
      session.lastError = null
      return snapshotOf(session)
    } catch (error) {
      session.status = 'CRASHED'
      session.lastError = messageFor(error)
      throw new Error(`浏览器关闭失败：${session.lastError}`, { cause: error })
    }
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.sessions.entries()].map(async ([profileId, session]) => {
        if (session.status === 'RUNNING' || session.status === 'CRASHED') await this.stop(profileId)
      }),
    )
  }
}

function injectableHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed = new Set([
    'accept-language',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-ch-ua-platform-version',
  ])
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => allowed.has(name.toLowerCase())),
  )
}

async function readCdpEndpoint(userDataDirectory: string): Promise<string | null> {
  const deadline = Date.now() + CDP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const content = await readFile(path.join(userDataDirectory, 'DevToolsActivePort'), 'utf8')
      const [port] = content.trim().split(/\r?\n/)
      if (port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`
    } catch {
      // Chrome creates DevToolsActivePort asynchronously.
    }
    await delay(100)
  }
  return null
}

function snapshotOf(session: RuntimeSession | undefined): BrowserRuntimeSnapshot {
  if (!session) return stoppedSnapshot()
  return {
    status: session.status,
    cdpEndpoint: session.cdpEndpoint,
    startedAt: session.startedAt,
    lastError: session.lastError,
  }
}

function stoppedSnapshot(): BrowserRuntimeSnapshot {
  return { status: 'STOPPED', cdpEndpoint: null, startedAt: null, lastError: null }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
