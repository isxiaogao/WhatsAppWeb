import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { BrowserProfileStore } from '../dist/browser-profile-store.js'

const validInput = {
  name: '客服一组',
  owner: '运营-张三',
  purpose: 'WhatsApp 客服会话',
  browser: 'chrome',
  proxyUrl: '127.0.0.1:7890',
  startUrl: 'https://web.whatsapp.com',
  timezone: 'Asia/Shanghai',
}

test('creates and concurrently persists independent browser profiles', async () => {
  await withTemporaryStore(async (store, directory) => {
    const profiles = await Promise.all(
      Array.from({ length: 6 }, (_, index) => store.create({ ...validInput, name: `客服-${index}` })),
    )

    assert.equal(profiles.length, 6)
    assert.equal(new Set(profiles.map((profile) => profile.id)).size, 6)
    assert.equal(profiles[0].proxyUrl, 'http://127.0.0.1:7890')
    assert.equal(profiles[0].startUrl, 'https://web.whatsapp.com/')
    assert.equal((await store.list()).length, 6)

    const state = JSON.parse(await readFile(path.join(directory, 'browser-profiles.json'), 'utf8'))
    assert.equal(state.profiles.length, 6)
  })
})

test('migrates profiles created before proxy, website, and timezone settings existed', async () => {
  await withTemporaryStore(async (store, directory) => {
    await writeFile(
      path.join(directory, 'browser-profiles.json'),
      JSON.stringify({
        profiles: [
          {
            id: 'legacy-profile',
            name: '旧档案',
            owner: '运营',
            purpose: '客服',
            browser: 'edge',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastOpenedAt: null,
          },
        ],
      }),
      'utf8',
    )

    const [profile] = await store.list()
    assert.equal(profile.startUrl, 'https://web.whatsapp.com/')
    assert.equal(profile.proxyUrl, null)
    assert.ok(profile.timezone)
  })
})

test('rejects unsupported proxy, website, timezone, and browser values', async () => {
  await withTemporaryStore(async (store) => {
    await assert.rejects(store.create({ ...validInput, proxyUrl: 'ftp://127.0.0.1' }), /代理仅支持/)
    await assert.rejects(store.create({ ...validInput, startUrl: 'file:///secret' }), /仅支持 HTTP/)
    await assert.rejects(store.create({ ...validInput, timezone: 'Mars/Olympus' }), /IANA 时区/)
    await assert.rejects(store.create({ ...validInput, browser: 'firefox' }), /受支持的浏览器/)
  })
})

async function withTemporaryStore(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-profile-store-test-'))
  try {
    await callback(new BrowserProfileStore(directory), directory)
  } finally {
    const resolved = path.resolve(directory)
    const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`
    if (!resolved.startsWith(temporaryRoot)) throw new Error('Refusing to clean outside the temporary directory')
    await rm(resolved, { recursive: true, force: true })
  }
}
