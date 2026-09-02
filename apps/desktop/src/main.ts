import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, session, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BrowserProfileManager } from './browser-profile-manager.js'
import { BrowserProfileStore, type BrowserProfileInput } from './browser-profile-store.js'
import { ChromiumRuntime } from './chromium-runtime.js'
import { loadDesktopConfig, saveDesktopConfig, type DesktopConfig } from './config.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopDirectory = path.resolve(currentDirectory, '..')
const rendererDirectory = path.join(desktopDirectory, 'renderer')
const developmentServerUrl = process.env.ELECTRON_RENDERER_URL

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true },
  },
])

let desktopConfig: DesktopConfig
let browserProfiles: BrowserProfileManager
let quitting = false

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b100d',
    show: false,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://renderer/') && url !== developmentServerUrl) event.preventDefault()
  })

  if (developmentServerUrl) {
    void window.loadURL(developmentServerUrl)
  } else {
    void window.loadURL('app://renderer/index.html')
  }
  return window
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function rendererFilePath(requestUrl: string): string | null {
  const url = new URL(requestUrl)
  if (url.hostname !== 'renderer') return null
  const requestedPath = decodeURIComponent(url.pathname)
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '')
  const candidate = path.resolve(rendererDirectory, relativePath)
  const allowedPrefix = `${rendererDirectory}${path.sep}`
  return candidate === rendererDirectory || candidate.startsWith(allowedPrefix) ? candidate : null
}

app.whenReady().then(async () => {
  desktopConfig = await loadDesktopConfig(app.getPath('userData'))
  const profileStore = new BrowserProfileStore(app.getPath('userData'), {
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用')
      return safeStorage.encryptString(value).toString('base64')
    },
    decrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用')
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    },
  })
  browserProfiles = new BrowserProfileManager(profileStore, new ChromiumRuntime())

  protocol.handle('app', (request) => {
    const filePath = rendererFilePath(request.url)
    if (!filePath) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith('app://renderer/')) {
      return details.responseHeaders
        ? callback({ responseHeaders: details.responseHeaders })
        : callback({})
    }
    const apiOrigin = new URL(desktopConfig.controlApiUrl).origin
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; connect-src 'self' ${apiOrigin}; img-src 'self' ${apiOrigin} data: blob:; media-src 'self' ${apiOrigin} blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
        ],
      },
    })
  })

  ipcMain.handle('desktop:config:get', (event) => {
    assertTrustedIpcSender(event.sender.getURL())
    return desktopConfig
  })
  ipcMain.handle('desktop:config:save', async (event, input: DesktopConfig) => {
    assertTrustedIpcSender(event.sender.getURL())
    desktopConfig = await saveDesktopConfig(app.getPath('userData'), input)
    return desktopConfig
  })
  ipcMain.handle('desktop:app:version', (event) => {
    assertTrustedIpcSender(event.sender.getURL())
    return app.getVersion()
  })
  ipcMain.handle('desktop:browser-profiles:list', async (event) => {
    assertTrustedIpcSender(event.sender.getURL())
    return browserProfiles.list()
  })
  ipcMain.handle(
    'desktop:browser-profiles:create',
    async (event, input: BrowserProfileInput) => {
      assertTrustedIpcSender(event.sender.getURL())
      return browserProfiles.create(input)
    },
  )
  ipcMain.handle(
    'desktop:browser-profiles:update',
    async (event, profileId: string, input: BrowserProfileInput) => {
      assertTrustedIpcSender(event.sender.getURL())
      return browserProfiles.update(profileId, input)
    },
  )
  ipcMain.handle('desktop:browser-profiles:delete', async (event, profileId: string) => {
    assertTrustedIpcSender(event.sender.getURL())
    await browserProfiles.delete(profileId)
  })
  ipcMain.handle('desktop:browser-profiles:start', async (event, profileId: string) => {
    assertTrustedIpcSender(event.sender.getURL())
    if (typeof profileId !== 'string') throw new Error('浏览器档案标识无效')
    return browserProfiles.start(profileId)
  })
  ipcMain.handle('desktop:browser-profiles:stop', async (event, profileId: string) => {
    assertTrustedIpcSender(event.sender.getURL())
    if (typeof profileId !== 'string') throw new Error('浏览器档案标识无效')
    return browserProfiles.stop(profileId)
  })
  ipcMain.handle('desktop:browser-profiles:status', (event, profileId: string) => {
    assertTrustedIpcSender(event.sender.getURL())
    if (typeof profileId !== 'string') throw new Error('浏览器档案标识无效')
    return browserProfiles.status(profileId)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function assertTrustedIpcSender(url: string): void {
  if (url.startsWith('app://renderer/') || (developmentServerUrl && url.startsWith(developmentServerUrl))) {
    return
  }
  throw new Error('不受信任的桌面端请求来源')
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting || !browserProfiles) return
  event.preventDefault()
  quitting = true
  void browserProfiles.shutdown().finally(() => app.quit())
})
