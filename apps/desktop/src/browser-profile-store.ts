import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { FingerprintGenerator, type BrowserFingerprintWithHeaders } from 'fingerprint-generator'

export type BrowserKind = 'chrome' | 'edge'
export type BrowserFingerprintMode = 'enhanced' | 'native'

export interface BrowserProfileInput {
  name: string
  owner: string
  purpose: string
  browser: BrowserKind
  proxyUrl: string
  proxyUsername: string
  proxyPassword: string
  clearProxyPassword: boolean
  startUrl: string
  timezone: string
  locale: string
  fingerprintMode: BrowserFingerprintMode
}

export interface BrowserFingerprintSummary {
  userAgent: string
  platform: string
  language: string
  screen: string
  hardwareConcurrency: number
  webgl: string
}

export interface BrowserProfile {
  id: string
  name: string
  owner: string
  purpose: string
  browser: BrowserKind
  proxyUrl: string | null
  proxyUsername: string | null
  hasProxyPassword: boolean
  startUrl: string
  timezone: string
  locale: string
  fingerprintMode: BrowserFingerprintMode
  fingerprint: BrowserFingerprintSummary
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
}

export interface BrowserRuntimeProfile extends Omit<BrowserProfile, 'fingerprint' | 'hasProxyPassword'> {
  proxyPassword: string | null
  fingerprint: BrowserFingerprintWithHeaders
}

export interface BrowserProfileSecretCodec {
  encrypt(value: string): string
  decrypt(value: string): string
}

interface StoredBrowserProfile {
  id: string
  name: string
  owner: string
  purpose: string
  browser: BrowserKind
  proxyUrl: string | null
  proxyUsername: string | null
  encryptedProxyPassword: string | null
  startUrl: string
  timezone: string
  locale: string
  fingerprintMode: BrowserFingerprintMode
  fingerprintVersion: 1
  fingerprint: BrowserFingerprintWithHeaders
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
}

interface BrowserProfileState {
  version: 2
  profiles: StoredBrowserProfile[]
}

const DEFAULT_START_URL = 'https://web.whatsapp.com/'
const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const DEFAULT_LOCALE = Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN'
const STATE_VERSION = 2

export class BrowserProfileStore {
  private pendingOperation: Promise<void> = Promise.resolve()

  constructor(
    private readonly userDataDirectory: string,
    private readonly secretCodec?: BrowserProfileSecretCodec,
  ) {}

  async list(): Promise<BrowserProfile[]> {
    return this.runExclusive(async () => {
      const state = await this.load()
      return state.profiles
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(toPublicProfile)
    })
  }

  async create(input: BrowserProfileInput): Promise<BrowserProfile> {
    const normalized = normalizeInput(input)
    return this.runExclusive(async () => {
      const now = new Date().toISOString()
      const profile: StoredBrowserProfile = {
        id: crypto.randomUUID(),
        name: normalized.name,
        owner: normalized.owner,
        purpose: normalized.purpose,
        browser: normalized.browser,
        proxyUrl: normalized.proxyUrl,
        proxyUsername: normalized.proxyUsername,
        encryptedProxyPassword: this.encryptProxyPassword(normalized.proxyPassword),
        startUrl: normalized.startUrl,
        timezone: normalized.timezone,
        locale: normalized.locale,
        fingerprintMode: normalized.fingerprintMode,
        fingerprintVersion: 1,
        fingerprint: generateFingerprint(normalized.browser, normalized.locale),
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      }
      const state = await this.load()
      const directory = this.profileDirectory(profile.id)
      await mkdir(directory, { recursive: true })
      state.profiles.push(profile)
      try {
        await this.save(state)
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
      return toPublicProfile(profile)
    })
  }

  async update(profileId: string, input: BrowserProfileInput): Promise<BrowserProfile> {
    const normalizedProfileId = requiredText(profileId, '浏览器档案标识')
    const normalized = normalizeInput(input)
    return this.runExclusive(async () => {
      const state = await this.load()
      const index = state.profiles.findIndex((profile) => profile.id === normalizedProfileId)
      if (index < 0) throw new Error('浏览器档案不存在')
      const existing = state.profiles[index]
      if (!existing) throw new Error('浏览器档案不存在')
      const regenerateFingerprint =
        existing.browser !== normalized.browser || existing.locale !== normalized.locale
      const encryptedProxyPassword = normalized.clearProxyPassword
        ? null
        : normalized.proxyPassword
          ? this.encryptProxyPassword(normalized.proxyPassword)
          : existing.encryptedProxyPassword
      const updated: StoredBrowserProfile = {
        ...existing,
        name: normalized.name,
        owner: normalized.owner,
        purpose: normalized.purpose,
        browser: normalized.browser,
        proxyUrl: normalized.proxyUrl,
        proxyUsername: normalized.proxyUsername,
        encryptedProxyPassword,
        startUrl: normalized.startUrl,
        timezone: normalized.timezone,
        locale: normalized.locale,
        fingerprintMode: normalized.fingerprintMode,
        fingerprint: regenerateFingerprint
          ? generateFingerprint(normalized.browser, normalized.locale)
          : existing.fingerprint,
        updatedAt: new Date().toISOString(),
      }
      state.profiles[index] = updated
      await this.save(state)
      return toPublicProfile(updated)
    })
  }

  async delete(profileId: string): Promise<void> {
    const normalizedProfileId = requiredText(profileId, '浏览器档案标识')
    await this.runExclusive(async () => {
      const state = await this.load()
      const index = state.profiles.findIndex((profile) => profile.id === normalizedProfileId)
      if (index < 0) throw new Error('浏览器档案不存在')
      state.profiles.splice(index, 1)
      await this.save(state)
      const directory = this.profileDirectory(normalizedProfileId)
      this.assertProfileDirectory(directory)
      await rm(directory, { recursive: true, force: true })
    })
  }

  async runtimeProfile(profileId: string): Promise<BrowserRuntimeProfile> {
    const normalizedProfileId = requiredText(profileId, '浏览器档案标识')
    return this.runExclusive(async () => {
      const state = await this.load()
      const profile = state.profiles.find((item) => item.id === normalizedProfileId)
      if (!profile) throw new Error('浏览器档案不存在')
      const publicProfile = toPublicProfile(profile)
      const { fingerprint: _summary, hasProxyPassword: _hasPassword, ...runtimeBase } = publicProfile
      return {
        ...runtimeBase,
        proxyPassword: profile.encryptedProxyPassword
          ? this.decryptProxyPassword(profile.encryptedProxyPassword)
          : null,
        fingerprint: structuredClone(profile.fingerprint),
      }
    })
  }

  async markOpened(profileId: string): Promise<BrowserProfile> {
    const normalizedProfileId = requiredText(profileId, '浏览器档案标识')
    return this.runExclusive(async () => {
      const state = await this.load()
      const index = state.profiles.findIndex((profile) => profile.id === normalizedProfileId)
      if (index < 0) throw new Error('浏览器档案不存在')
      const profile = state.profiles[index]
      if (!profile) throw new Error('浏览器档案不存在')
      const opened = { ...profile, lastOpenedAt: new Date().toISOString() }
      state.profiles[index] = opened
      await this.save(state)
      return toPublicProfile(opened)
    })
  }

  profileDataDirectory(profileId: string): string {
    const directory = this.profileDirectory(requiredText(profileId, '浏览器档案标识'))
    this.assertProfileDirectory(directory)
    return directory
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingOperation.then(operation, operation)
    this.pendingOperation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async load(): Promise<BrowserProfileState> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.statePath(), 'utf8'))
      const state = normalizeStoredState(parsed)
      if (needsMigration(parsed)) await this.save(state)
      return state
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return { version: STATE_VERSION, profiles: [] }
      if (error instanceof SyntaxError) throw new Error('浏览器档案文件已损坏，无法读取。', { cause: error })
      throw error
    }
  }

  private async save(state: BrowserProfileState): Promise<void> {
    await mkdir(this.userDataDirectory, { recursive: true })
    const statePath = this.statePath()
    const temporaryPath = `${statePath}.${process.pid}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, statePath)
  }

  private encryptProxyPassword(value: string | null): string | null {
    if (!value) return null
    if (!this.secretCodec) throw new Error('系统安全存储不可用，无法保存代理密码')
    return this.secretCodec.encrypt(value)
  }

  private decryptProxyPassword(value: string): string {
    if (!this.secretCodec) throw new Error('系统安全存储不可用，无法读取代理密码')
    return this.secretCodec.decrypt(value)
  }

  private statePath(): string {
    return path.join(this.userDataDirectory, 'browser-profiles.json')
  }

  private profilesRoot(): string {
    return path.resolve(this.userDataDirectory, 'browser-profiles')
  }

  private profileDirectory(profileId: string): string {
    return path.resolve(this.profilesRoot(), profileId)
  }

  private assertProfileDirectory(directory: string): void {
    if (path.dirname(directory) !== this.profilesRoot()) throw new Error('浏览器档案目录无效')
  }
}

export async function resolveBrowserExecutable(browser: BrowserKind): Promise<string | null> {
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env.LOCALAPPDATA
  const candidates =
    browser === 'chrome'
      ? [
          programFiles && path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      : [
          programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          programFilesX86 && path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          localAppData && path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next standard installation location.
    }
  }
  return null
}

function normalizeInput(input: BrowserProfileInput) {
  if (!isRecord(input)) throw new Error('浏览器档案参数无效')
  if (input.browser !== 'chrome' && input.browser !== 'edge') throw new Error('请选择受支持的浏览器')
  const fingerprintMode = input.fingerprintMode ?? 'enhanced'
  if (fingerprintMode !== 'enhanced' && fingerprintMode !== 'native') {
    throw new Error('请选择受支持的指纹模式')
  }
  return {
    name: requiredText(input.name, '浏览器名称'),
    owner: requiredText(input.owner, '责任人'),
    purpose: requiredText(input.purpose, '使用用途'),
    browser: input.browser,
    proxyUrl: normalizeProxyUrl(input.proxyUrl),
    proxyUsername: optionalText(input.proxyUsername ?? '', '代理用户名', 128),
    proxyPassword: optionalText(input.proxyPassword ?? '', '代理密码', 256),
    clearProxyPassword: input.clearProxyPassword === true,
    startUrl: normalizeStartUrl(input.startUrl),
    timezone: normalizeTimezone(input.timezone),
    locale: normalizeLocale(input.locale ?? DEFAULT_LOCALE),
    fingerprintMode,
  }
}

function normalizeStoredState(input: unknown): BrowserProfileState {
  if (!isRecord(input) || !Array.isArray(input.profiles)) throw new Error('浏览器档案文件格式无效')
  return { version: STATE_VERSION, profiles: input.profiles.map(normalizeStoredProfile) }
}

function normalizeStoredProfile(input: unknown): StoredBrowserProfile {
  if (!isRecord(input)) throw new Error('浏览器档案记录格式无效')
  const browser = input.browser
  if (browser !== 'chrome' && browser !== 'edge') throw new Error('浏览器档案包含不支持的浏览器')
  const locale = normalizeLocale(typeof input.locale === 'string' ? input.locale : DEFAULT_LOCALE)
  const fingerprintMode = input.fingerprintMode === 'native' ? 'native' : 'enhanced'
  const createdAt = requiredText(input.createdAt, '创建时间')
  const lastOpenedAt = input.lastOpenedAt
  if (lastOpenedAt !== null && lastOpenedAt !== undefined && typeof lastOpenedAt !== 'string') {
    throw new Error('浏览器档案打开时间无效')
  }
  return {
    id: requiredText(input.id, '浏览器档案标识'),
    name: requiredText(input.name, '浏览器名称'),
    owner: requiredText(input.owner, '责任人'),
    purpose: requiredText(input.purpose, '使用用途'),
    browser,
    proxyUrl: normalizeProxyUrl(typeof input.proxyUrl === 'string' ? input.proxyUrl : ''),
    proxyUsername: optionalText(typeof input.proxyUsername === 'string' ? input.proxyUsername : '', '代理用户名', 128),
    encryptedProxyPassword:
      typeof input.encryptedProxyPassword === 'string' && input.encryptedProxyPassword
        ? input.encryptedProxyPassword
        : null,
    startUrl: normalizeStartUrl(typeof input.startUrl === 'string' ? input.startUrl : DEFAULT_START_URL),
    timezone: normalizeTimezone(typeof input.timezone === 'string' ? input.timezone : DEFAULT_TIMEZONE),
    locale,
    fingerprintMode,
    fingerprintVersion: 1,
    fingerprint: isBrowserFingerprint(input.fingerprint)
      ? (structuredClone(input.fingerprint) as BrowserFingerprintWithHeaders)
      : generateFingerprint(browser, locale),
    createdAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : createdAt,
    lastOpenedAt: typeof lastOpenedAt === 'string' ? lastOpenedAt : null,
  }
}

function needsMigration(input: unknown): boolean {
  if (!isRecord(input) || input.version !== STATE_VERSION || !Array.isArray(input.profiles)) return true
  return input.profiles.some(
    (profile) =>
      !isRecord(profile) ||
      profile.fingerprintVersion !== 1 ||
      !isBrowserFingerprint(profile.fingerprint) ||
      typeof profile.locale !== 'string' ||
      typeof profile.updatedAt !== 'string',
  )
}

function generateFingerprint(browser: BrowserKind, locale: string): BrowserFingerprintWithHeaders {
  const generator = new FingerprintGenerator({
    browsers: [browser],
    devices: ['desktop'],
    operatingSystems: ['windows'],
    locales: [locale],
    screen: { minWidth: 1280, maxWidth: 1920, minHeight: 720, maxHeight: 1200 },
    mockWebRTC: false,
  })
  return generator.getFingerprint()
}

function toPublicProfile(profile: StoredBrowserProfile): BrowserProfile {
  const fingerprint = profile.fingerprint.fingerprint
  return {
    id: profile.id,
    name: profile.name,
    owner: profile.owner,
    purpose: profile.purpose,
    browser: profile.browser,
    proxyUrl: profile.proxyUrl,
    proxyUsername: profile.proxyUsername,
    hasProxyPassword: Boolean(profile.encryptedProxyPassword),
    startUrl: profile.startUrl,
    timezone: profile.timezone,
    locale: profile.locale,
    fingerprintMode: profile.fingerprintMode,
    fingerprint: {
      userAgent: fingerprint.navigator.userAgent,
      platform: fingerprint.navigator.platform,
      language: fingerprint.navigator.language,
      screen: `${fingerprint.screen.width} × ${fingerprint.screen.height} @ ${fingerprint.screen.devicePixelRatio}`,
      hardwareConcurrency: fingerprint.navigator.hardwareConcurrency,
      webgl: `${fingerprint.videoCard.vendor} / ${fingerprint.videoCard.renderer}`,
    },
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastOpenedAt: profile.lastOpenedAt,
  }
}

function normalizeProxyUrl(value: unknown): string | null {
  if (typeof value !== 'string') throw new Error('代理地址格式无效')
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > 2048) throw new Error('代理地址不能超过 2048 个字符')
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new Error('代理地址格式无效，例如：http://127.0.0.1:7890')
  }
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(url.protocol) || !url.hostname) {
    throw new Error('代理仅支持 HTTP、HTTPS、SOCKS4 或 SOCKS5')
  }
  if (url.username || url.password) throw new Error('请在独立字段中填写代理账号和密码')
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) throw new Error('代理地址不能包含路径或参数')
  return `${url.protocol}//${url.host}`
}

function normalizeStartUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('打开网站格式无效')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('请输入完整的网站地址，例如：https://web.whatsapp.com')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('打开网站仅支持 HTTP 或 HTTPS')
  if (url.username || url.password) throw new Error('打开网站不能包含账号密码')
  return url.toString()
}

function normalizeTimezone(value: unknown): string {
  const timezone = requiredText(value, '时区')
  if (timezone.length > 100) throw new Error('时区不能超过 100 个字符')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
  } catch {
    throw new Error('请输入有效的 IANA 时区，例如：Asia/Shanghai')
  }
  return timezone
}

function normalizeLocale(value: unknown): string {
  const locale = requiredText(value, '语言地区')
  try {
    return new Intl.Locale(locale).toString()
  } catch {
    throw new Error('请输入有效的语言地区，例如：zh-CN')
  }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}格式无效`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label}不能为空`)
  if (trimmed.length > 80) throw new Error(`${label}不能超过 80 个字符`)
  return trimmed
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (typeof value !== 'string') throw new Error(`${label}格式无效`)
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  return trimmed
}

function isBrowserFingerprint(input: unknown): boolean {
  return (
    isRecord(input) &&
    isRecord(input.headers) &&
    isRecord(input.fingerprint) &&
    isRecord(input.fingerprint.navigator) &&
    isRecord(input.fingerprint.screen) &&
    isRecord(input.fingerprint.videoCard)
  )
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
