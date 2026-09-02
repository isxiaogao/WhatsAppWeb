import assert from 'node:assert/strict'
import { S3MediaStorage } from '../apps/server/dist/media-storage.js'

const storage = new S3MediaStorage()
const body = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=',
  'base64',
)
let storageKey = null

try {
  storageKey = await storage.put({
    id: crypto.randomUUID(),
    accountId: 'storage-smoke',
    kind: 'IMAGE',
    fileName: 'health.png',
    mimeType: 'image/png',
    body,
  })
  const stored = await storage.get(storageKey)
  const chunks = []
  for await (const chunk of stored.body) chunks.push(Buffer.from(chunk))
  assert.deepEqual(Buffer.concat(chunks), body)

  const downloadUrl = await storage.createDownloadUrl(storageKey)
  const delivered = await fetch(downloadUrl)
  assert.equal(delivered.status, 200)
  assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), body)
  console.log(JSON.stringify({ ok: true, storedBytes: body.byteLength, signedDownload: 200 }))
} finally {
  if (storageKey) await storage.delete(storageKey)
}
