export interface DesktopRuntimeConfig {
  controlApiUrl: string
}

export type BrowserRuntimeStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'CRASHED'
export type BrowserFingerprintMode = 'enhanced' | 'native'

export interface BrowserRuntimeSnapshot {
  status: BrowserRuntimeStatus
  cdpEndpoint: string | null
  startedAt: string | null
  lastError: string | null
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
  browser: 'chrome' | 'edge'
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
  runtime: BrowserRuntimeSnapshot
}

export interface BrowserProfileInput {
  name: string
  owner: string
  purpose: string
  browser: BrowserProfile['browser']
  proxyUrl: string
  proxyUsername: string
  proxyPassword: string
  clearProxyPassword: boolean
  startUrl: string
  timezone: string
  locale: string
  fingerprintMode: BrowserFingerprintMode
}

declare global {
  interface Window {
    desktop?: {
      apiVersion: number
      getRuntimeConfig(): Promise<DesktopRuntimeConfig>
      saveRuntimeConfig(input: DesktopRuntimeConfig): Promise<DesktopRuntimeConfig>
      getVersion(): Promise<string>
      listBrowserProfiles(): Promise<BrowserProfile[]>
      createBrowserProfile(input: BrowserProfileInput): Promise<BrowserProfile>
      updateBrowserProfile(profileId: string, input: BrowserProfileInput): Promise<BrowserProfile>
      deleteBrowserProfile(profileId: string): Promise<void>
      startBrowserProfile(profileId: string): Promise<BrowserProfile>
      stopBrowserProfile(profileId: string): Promise<BrowserProfile>
      getBrowserProfileStatus(profileId: string): Promise<BrowserRuntimeSnapshot>
    }
  }
}

export {}
