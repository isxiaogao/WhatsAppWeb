import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { buildApp } from './app.js'
import { ControlCenterService } from './control-center.js'
import type { Account } from './domain.js'
import { MemoryMediaStorage } from './media-storage.js'
import { EvolutionClient } from './providers/evolution-client.js'
import { EvolutionProvider } from './providers/evolution-provider.js'
import type {
  ProviderHealth,
  ProviderSink,
  SendMediaInput,
  SendResult,
  WhatsAppProvider,
} from './providers/provider.js'
import { MemoryStateStore } from './state-store.js'

class TestEvolutionProvider implements WhatsAppProvider {
  readonly mode = 'evolution' as const
  private sink: ProviderSink | null = null
  lastMedia: SendMediaInput | null = null
  avatarBase64: string | null = null
  avatarUpdateCalls = 0
  avatarUpdateDelayMs = 0
  deletedInstanceNames: string[] = []

  async connect(account: Account, sink: ProviderSink): Promise<void> {
    this.sink = sink
    sink.onInstance(account.id, 'evolution-instance-id')
    sink.onIdentity(account.id, '+85261234567')
    sink.onStatus(account.id, 'ONLINE')
  }

  async disconnect(account: Account): Promise<void> {
    void account
  }

  async deleteInstance(account: Account): Promise<void> {
    this.deletedInstanceNames.push(account.evolution.instanceName)
  }

  async sendText(_account: Account, _conversationId: string, _text: string): Promise<SendResult> {
    return { providerMessageId: `provider_${crypto.randomUUID()}` }
  }

  async sendMedia(
    _account: Account,
    _conversationId: string,
    input: SendMediaInput,
  ): Promise<SendResult> {
    this.lastMedia = input
    return { providerMessageId: `provider_media_${crypto.randomUUID()}` }
  }

  async updateProfilePicture(_account: Account, pictureBase64: string): Promise<void> {
    this.avatarUpdateCalls += 1
    if (this.avatarUpdateDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.avatarUpdateDelayMs))
    }
    this.avatarBase64 = pictureBase64
  }

  async removeProfilePicture(_account: Account): Promise<void> {
    this.avatarBase64 = null
  }

  async handleWebhook(account: Account, payload: unknown): Promise<void> {
    const body = payload as { text?: string; mediaBase64?: string }
    await this.sink?.onMessage(account.id, {
      providerMessageId: body.mediaBase64 ? 'incoming-media-provider-id' : 'incoming-provider-id',
      conversationId: '85261234567@s.whatsapp.net',
      direction: 'IN',
      kind: body.mediaBase64 ? 'IMAGE' : 'TEXT',
      body: body.text ?? (body.mediaBase64 ? '[图片]' : ''),
      media: body.mediaBase64
        ? {
            kind: 'IMAGE',
            mimeType: 'image/png',
            fileName: 'incoming.png',
            size: samplePng().byteLength,
            base64: body.mediaBase64,
          }
        : null,
      status: 'RECEIVED',
      createdAt: new Date().toISOString(),
    })
  }

  async health(): Promise<ProviderHealth> {
    return { ok: true, endpoint: 'http://evolution.test', version: '2.3.7', error: null }
  }
}

test('Evolution provider contract, messaging, webhook, and state persistence', async (context) => {
  const store = new MemoryStateStore()
  const mediaStorage = new MemoryMediaStorage()
  const provider = new TestEvolutionProvider()
  const service = new ControlCenterService({ provider, store, mediaStorage })
  const app = buildApp(service)
  context.after(async () => app.close())

  const created = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    payload: { name: '香港实际账号' },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().providerMode, 'evolution')
  assert.match(created.json().evolution.instanceName, /^wa_[a-f0-9]{32}$/)
  const accountId = created.json().id as string

  const connect = await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/connect` })
  assert.equal(connect.statusCode, 200)
  assert.equal(connect.json().status, 'ONLINE')
  assert.equal(connect.json().phone, '+85261234567')

  const chat = await app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/conversations`,
    payload: { target: '+852 6123 4567', name: 'Test Contact' },
  })
  const conversationId = chat.json().id as string
  assert.equal(conversationId, '85261234567@s.whatsapp.net')

  const sent = await app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/conversations/${encodeURIComponent(conversationId)}/messages`,
    payload: { text: 'Actual provider contract message', clientRef: 'test-real-1' },
  })
  assert.equal(sent.statusCode, 201)
  assert.equal(sent.json().status, 'SENT')
  assert.match(sent.json().providerMessageId, /^provider_/)

  const imageUpload = multipartBody(
    { caption: '真实媒体契约图片', clientRef: 'test-media-1' },
    { fileName: 'proof.png', mimeType: 'image/png', body: samplePng() },
  )
  const mediaSent = await app.inject({
    method: 'POST',
    url: `/api/accounts/${accountId}/conversations/${encodeURIComponent(conversationId)}/media`,
    headers: { 'content-type': imageUpload.contentType },
    payload: imageUpload.body,
  })
  assert.equal(mediaSent.statusCode, 201, mediaSent.body)
  assert.equal(mediaSent.json().kind, 'IMAGE')
  assert.equal(mediaSent.json().status, 'SENT')
  assert.equal(mediaSent.json().body, '真实媒体契约图片')
  assert.equal(provider.lastMedia?.kind, 'IMAGE')
  assert.deepEqual(provider.lastMedia?.body, samplePng())

  const storedImage = await app.inject({ method: 'GET', url: mediaSent.json().media.url })
  assert.equal(storedImage.statusCode, 200)
  assert.equal(storedImage.headers['content-type'], 'image/png')
  assert.deepEqual(storedImage.rawPayload, samplePng())

  const avatarUpload = multipartBody(
    {},
    { fileName: 'avatar.png', mimeType: 'image/png', body: samplePng() },
  )
  const avatar = await app.inject({
    method: 'PUT',
    url: `/api/accounts/${accountId}/avatar`,
    headers: { 'content-type': avatarUpload.contentType },
    payload: avatarUpload.body,
  })
  assert.equal(avatar.statusCode, 200, avatar.body)
  assert.match(avatar.json().avatarUrl, /^\/api\/media\//)
  assert.equal(provider.avatarBase64, samplePng().toString('base64'))

  const avatarRemoved = await app.inject({
    method: 'DELETE',
    url: `/api/accounts/${accountId}/avatar`,
  })
  assert.equal(avatarRemoved.statusCode, 200)
  assert.equal(avatarRemoved.json().avatarUrl, null)
  assert.equal(provider.avatarBase64, null)

  const rejectedWebhook = await app.inject({
    method: 'POST',
    url: `/api/webhooks/evolution/${accountId}`,
    payload: { text: 'should be rejected' },
  })
  assert.equal(rejectedWebhook.statusCode, 401)

  const webhook = await app.inject({
    method: 'POST',
    url: `/api/webhooks/evolution/${accountId}`,
    headers: { 'x-control-webhook-secret': 'local-mvp-webhook-secret' },
    payload: { text: '真实入站 Webhook' },
  })
  assert.equal(webhook.statusCode, 204)
  const mediaWebhook = await app.inject({
    method: 'POST',
    url: `/api/webhooks/evolution/${accountId}`,
    headers: { 'x-control-webhook-secret': 'local-mvp-webhook-secret' },
    payload: { mediaBase64: samplePng().toString('base64') },
  })
  assert.equal(mediaWebhook.statusCode, 204)
  const messages = service.listMessages(accountId, conversationId)
  assert.equal(messages.length, 4)
  const incomingMedia = messages.find((message) => message.providerMessageId === 'incoming-media-provider-id')
  assert.equal(incomingMedia?.kind, 'IMAGE')
  assert.match(incomingMedia?.media?.url ?? '', /^\/api\/media\//)

  const disposable = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    payload: { name: '待删除实例' },
  })
  const disposableId = disposable.json().id as string
  const disposableInstanceName = disposable.json().evolution.instanceName as string
  await app.inject({ method: 'POST', url: `/api/accounts/${disposableId}/connect` })
  const disposableAvatar = await app.inject({
    method: 'PUT',
    url: `/api/accounts/${disposableId}/avatar`,
    headers: { 'content-type': avatarUpload.contentType },
    payload: avatarUpload.body,
  })
  const disposableAvatarUrl = disposableAvatar.json().avatarUrl as string
  const deleted = await app.inject({ method: 'DELETE', url: `/api/accounts/${disposableId}` })
  assert.equal(deleted.statusCode, 200, deleted.body)
  assert.equal(deleted.json().id, disposableId)
  assert.ok(provider.deletedInstanceNames.includes(disposableInstanceName))
  assert.equal(service.listAccounts().some((account) => account.id === disposableId), false)
  assert.equal((await app.inject({ method: 'GET', url: disposableAvatarUrl })).statusCode, 404)

  const restoredService = new ControlCenterService({ provider, store, mediaStorage })
  const restoredAccount = restoredService.listAccounts()[0]
  assert.equal(restoredAccount?.id, accountId)
  assert.equal(restoredAccount?.status, 'OFFLINE')
  assert.equal(restoredService.listMessages(accountId, conversationId).length, 4)
  assert.equal(restoredService.listAccounts().some((account) => account.id === disposableId), false)
})

test('Evolution client uses multipart media, base64 avatar, and instance delete endpoint', async (context) => {
  const requests: Array<{
    method: string
    url: string
    contentType: string
    body: Buffer
  }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        contentType: String(request.headers['content-type'] ?? ''),
        body: Buffer.concat(chunks),
      })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ key: { id: 'provider-media-id' }, update: 'success' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => server.close())
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const client = new EvolutionClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: 'test-key',
  })

  await client.sendMedia('test-instance', {
    number: '85261234567',
    mediatype: 'image',
    mimetype: 'image/png',
    body: samplePng(),
    caption: 'multipart proof',
    fileName: 'proof.png',
  })
  await client.updateProfilePicture('test-instance', samplePng().toString('base64'))
  await client.deleteInstance('test-instance')

  assert.equal(requests.length, 3)
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[0]?.url, '/message/sendMedia/test-instance')
  assert.match(requests[0]?.contentType ?? '', /^multipart\/form-data; boundary=/)
  assert.match(requests[0]?.body.toString('latin1') ?? '', /name="file"; filename="proof.png"/)
  assert.ok((requests[0]?.body.indexOf(samplePng()) ?? -1) >= 0)
  assert.deepEqual(JSON.parse(requests[1]?.body.toString('utf8') ?? '{}'), {
    picture: samplePng().toString('base64'),
  })
  assert.equal(requests[2]?.method, 'DELETE')
  assert.equal(requests[2]?.url, '/instance/delete/test-instance')
})

test('duplicate concurrent avatar uploads share one provider operation', async () => {
  const provider = new TestEvolutionProvider()
  provider.avatarUpdateDelayMs = 25
  const service = new ControlCenterService({
    provider,
    store: new MemoryStateStore(),
    mediaStorage: new MemoryMediaStorage(),
  })
  const account = service.createAccount({ name: 'Avatar idempotency test' })
  await service.connectAccount(account.id)
  const image = samplePng()
  const input = {
    body: image,
    fileName: 'same-avatar.png',
    mimeType: 'image/png',
    size: image.byteLength,
  }

  const [first, second] = await Promise.all([
    service.updateAccountAvatar(account.id, input),
    service.updateAccountAvatar(account.id, { ...input, body: Buffer.from(image) }),
  ])

  assert.equal(provider.avatarUpdateCalls, 1)
  assert.equal(first.avatarMediaId, second.avatarMediaId)
})

test('provider observes connecting state without repeatedly calling instance connect', async () => {
  let connectCalls = 0
  const account: Account = {
    id: 'connecting-account',
    name: 'Connecting account',
    phone: '+18482409896',
    status: 'STARTING',
    providerMode: 'evolution',
    lastSeenAt: null,
    qrDataUrl: null,
    avatarUrl: null,
    avatarMediaId: null,
    error: null,
    evolution: {
      instanceName: 'wa_connecting_account',
      instanceId: 'instance-id',
      integration: 'WHATSAPP-BAILEYS',
    },
    createdAt: new Date().toISOString(),
  }
  const client = {
    fetchInstances: async () => [{ name: account.evolution.instanceName, id: 'instance-id' }],
    setWebhook: async () => ({}),
    connectionState: async () => ({ instance: { state: 'connecting' } }),
    connectInstance: async () => {
      connectCalls += 1
      return {}
    },
    logoutInstance: async () => ({}),
  } as unknown as EvolutionClient
  const provider = new EvolutionProvider({ client, pollIntervalMs: 5 })
  const sink: ProviderSink = {
    onStatus: () => undefined,
    onQr: () => undefined,
    onIdentity: () => undefined,
    onInstance: () => undefined,
    onConversation: () => undefined,
    onMessage: () => undefined,
  }

  await provider.connect(account, sink)
  await new Promise((resolve) => setTimeout(resolve, 35))
  await provider.disconnect(account)

  assert.equal(connectCalls, 0)
})

function samplePng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=',
    'base64',
  )
}

function multipartBody(
  fields: Record<string, string>,
  file: { fileName: string; mimeType: string; body: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----cloud-wa-${crypto.randomUUID()}`
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.fileName}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}
