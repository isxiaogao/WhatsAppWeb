const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const timeout = setTimeout(() => {
  console.error('Electron browser profiles regression timed out.')
  app.exit(1)
}, 15_000)

app.whenReady().then(async () => {
  const profile = (input) => ({
    id: 'electron-regression-profile',
    ...input,
    proxyUrl: input.proxyUrl || null,
    proxyUsername: input.proxyUsername || null,
    hasProxyPassword: Boolean(input.proxyPassword),
    fingerprint: {
      userAgent: 'Mozilla/5.0 Chrome/147.0.0.0',
      platform: 'Win32',
      language: input.locale,
      screen: '1920 × 1080 @ 1',
      hardwareConcurrency: 8,
      webgl: 'Google Inc. / ANGLE',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastOpenedAt: null,
    runtime: { status: 'STOPPED', cdpEndpoint: null, startedAt: null, lastError: null },
  })
  ipcMain.handle('desktop:config:get', () => ({ controlApiUrl: 'http://127.0.0.1:4100' }))
  ipcMain.handle('desktop:config:save', (_event, input) => input)
  ipcMain.handle('desktop:app:version', () => 'test')
  ipcMain.handle('desktop:browser-profiles:list', () => [])
  ipcMain.handle('desktop:browser-profiles:create', (_event, input) => profile(input))
  ipcMain.handle('desktop:browser-profiles:update', (_event, _profileId, input) => profile(input))
  ipcMain.handle('desktop:browser-profiles:delete', () => undefined)
  ipcMain.handle('desktop:browser-profiles:start', (_event, _profileId) => profile({}))
  ipcMain.handle('desktop:browser-profiles:stop', (_event, _profileId) => profile({}))
  ipcMain.handle('desktop:browser-profiles:status', () => ({
    status: 'STOPPED', cdpEndpoint: null, startedAt: null, lastError: null,
  }))

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '..', 'dist', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const consoleErrors = []
  window.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') consoleErrors.push(details.message)
  })
  await window.loadURL('http://127.0.0.1:5273')
  const hitTest = await window.webContents.executeJavaScript(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const runtime = document.querySelector('.runtime-state')?.textContent?.trim()
      const button = document.querySelector('button[title="浏览器档案"]')
      const rect = button?.getBoundingClientRect()
      const x = rect ? Math.round(rect.left + rect.width / 2) : null
      const y = rect ? Math.round(rect.top + rect.height / 2) : null
      const blocker = x !== null && y !== null ? document.elementFromPoint(x, y) : null
      return {
        runtime,
        buttonFound: Boolean(button),
        x,
        y,
        hitButtonTitle: blocker?.closest('button')?.title ?? null,
        blockerTag: blocker?.tagName ?? null,
        blockerClass: blocker?.className?.baseVal ?? blocker?.className ?? null,
        blockerText: blocker?.textContent?.trim().slice(0, 80) ?? null,
      }
    })()
  `)

  assert.equal(hitTest.runtime, 'DESKTOP')
  assert.equal(hitTest.buttonFound, true)
  assert.equal(hitTest.hitButtonTitle, '浏览器档案', JSON.stringify(hitTest))
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: hitTest.x,
    y: hitTest.y,
    button: 'left',
    clickCount: 1,
  })
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: hitTest.x,
    y: hitTest.y,
    button: 'left',
    clickCount: 1,
  })
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        const heading = document.querySelector('.browser-header h2')?.textContent?.trim() ?? null
        const loading = document.querySelector('.list-heading span')?.textContent?.trim() ?? null
        if (heading === '浏览器档案' && loading === null) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return {
        runtime: document.querySelector('.runtime-state')?.textContent?.trim(),
        buttonActive: document.querySelector('button[title="浏览器档案"]')?.classList.contains('active') ?? false,
        browserHeading: document.querySelector('.browser-header h2')?.textContent?.trim() ?? null,
        loading: document.querySelector('.list-heading span')?.textContent?.trim() ?? null,
        error: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
      }
    })()
  `)

  assert.deepEqual(result, {
    runtime: 'DESKTOP',
    buttonActive: true,
    browserHeading: '浏览器档案',
    loading: null,
    error: null,
  })
  assert.deepEqual(consoleErrors, [])
  clearTimeout(timeout)
  console.log('Electron browser profiles regression passed:', JSON.stringify({ hitTest, result }))
  app.exit(0)
}).catch((error) => {
  clearTimeout(timeout)
  console.error(error)
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  app.exit(1)
})
