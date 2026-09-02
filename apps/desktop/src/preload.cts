import { contextBridge, ipcRenderer } from 'electron'

export interface DesktopRuntimeConfig {
  controlApiUrl: string
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
  fingerprintMode: 'enhanced' | 'native'
  fingerprint: {
    userAgent: string
    platform: string
    language: string
    screen: string
    hardwareConcurrency: number
    webgl: string
  }
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
  runtime: BrowserRuntimeSnapshot
}

export interface BrowserRuntimeSnapshot {
  status: 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'CRASHED'
  cdpEndpoint: string | null
  startedAt: string | null
  lastError: string | null
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
  fingerprintMode: BrowserProfile['fingerprintMode']
}

contextBridge.exposeInMainWorld('desktop', {
  apiVersion: 3,
  getRuntimeConfig: (): Promise<DesktopRuntimeConfig> => ipcRenderer.invoke('desktop:config:get'),
  saveRuntimeConfig: (input: DesktopRuntimeConfig): Promise<DesktopRuntimeConfig> =>
    ipcRenderer.invoke('desktop:config:save', input),
  getVersion: (): Promise<string> => ipcRenderer.invoke('desktop:app:version'),
  listBrowserProfiles: (): Promise<BrowserProfile[]> => ipcRenderer.invoke('desktop:browser-profiles:list'),
  createBrowserProfile: (input: BrowserProfileInput): Promise<BrowserProfile> =>
    ipcRenderer.invoke('desktop:browser-profiles:create', input),
  updateBrowserProfile: (profileId: string, input: BrowserProfileInput): Promise<BrowserProfile> =>
    ipcRenderer.invoke('desktop:browser-profiles:update', profileId, input),
  deleteBrowserProfile: (profileId: string): Promise<void> =>
    ipcRenderer.invoke('desktop:browser-profiles:delete', profileId),
  startBrowserProfile: (profileId: string): Promise<BrowserProfile> =>
    ipcRenderer.invoke('desktop:browser-profiles:start', profileId),
  stopBrowserProfile: (profileId: string): Promise<BrowserProfile> =>
    ipcRenderer.invoke('desktop:browser-profiles:stop', profileId),
  getBrowserProfileStatus: (profileId: string): Promise<BrowserRuntimeSnapshot> =>
    ipcRenderer.invoke('desktop:browser-profiles:status', profileId),
})
