import cors from '@fastify/cors'
import multipart, { type MultipartFile } from '@fastify/multipart'
import Fastify from 'fastify'
import { ControlCenterService, type UploadedMedia } from './control-center.js'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 64 * 1024 * 1024
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export function buildApp(service = new ControlCenterService()) {
  const app = Fastify({ logger: false })
  void app.register(cors, { origin: true })
  void app.register(multipart, {
    limits: { files: 1, fields: 4, fileSize: MAX_VIDEO_BYTES },
  })

  app.get('/api/health', async () => {
    const provider = await service.getProviderHealth()
    return {
    ok: provider.ok,
    service: 'cloud-wa-control',
    version: '0.1.0',
    provider,
    time: new Date().toISOString(),
    }
  })

  app.get('/api/accounts', async () => ({ items: service.listAccounts() }))

  app.post('/api/accounts', async (request, reply) => {
    const body = request.body as { name?: string }
    const account = service.createAccount({
      name: body?.name ?? '',
    })
    return reply.code(201).send(account)
  })

  app.post('/api/accounts/:accountId/connect', async (request) => {
    const { accountId } = request.params as { accountId: string }
    return service.connectAccount(accountId)
  })

  app.post('/api/accounts/:accountId/disconnect', async (request) => {
    const { accountId } = request.params as { accountId: string }
    return service.disconnectAccount(accountId)
  })

  app.delete('/api/accounts/:accountId', async (request) => {
    const { accountId } = request.params as { accountId: string }
    return service.deleteAccount(accountId)
  })

  app.put('/api/accounts/:accountId/avatar', async (request) => {
    const { accountId } = request.params as { accountId: string }
    const upload = await readUpload(request, 'avatar')
    return service.updateAccountAvatar(accountId, upload.media)
  })

  app.delete('/api/accounts/:accountId/avatar', async (request) => {
    const { accountId } = request.params as { accountId: string }
    return service.removeAccountAvatar(accountId)
  })

  app.get('/api/accounts/:accountId/conversations', async (request) => {
    const { accountId } = request.params as { accountId: string }
    return { items: service.listConversations(accountId) }
  })

  app.post('/api/accounts/:accountId/conversations', async (request, reply) => {
    const { accountId } = request.params as { accountId: string }
    const body = request.body as { target?: string; name?: string }
    const conversation = service.createConversation(accountId, {
      target: body?.target ?? '',
      ...(body?.name ? { name: body.name } : {}),
    })
    return reply.code(201).send(conversation)
  })

  app.get('/api/accounts/:accountId/conversations/:conversationId/messages', async (request) => {
    const { accountId, conversationId } = request.params as {
      accountId: string
      conversationId: string
    }
    return { items: service.listMessages(accountId, conversationId) }
  })

  app.post('/api/accounts/:accountId/conversations/:conversationId/messages', async (request, reply) => {
    const { accountId, conversationId } = request.params as {
      accountId: string
      conversationId: string
    }
    const body = request.body as { text?: string; clientRef?: string }
    const message = await service.sendMessage(accountId, conversationId, {
      text: body?.text ?? '',
      ...(body?.clientRef ? { clientRef: body.clientRef } : {}),
    })
    return reply.code(201).send(message)
  })

  app.post('/api/accounts/:accountId/conversations/:conversationId/media', async (request, reply) => {
    const { accountId, conversationId } = request.params as {
      accountId: string
      conversationId: string
    }
    const upload = await readUpload(request, 'message')
    const part = upload.part
    const message = await service.sendMediaMessage(accountId, conversationId, {
      ...upload.media,
      caption: multipartField(part, 'caption'),
      clientRef: multipartField(part, 'clientRef') || crypto.randomUUID(),
    })
    return reply.code(201).send(message)
  })

  app.get('/api/media/:mediaId', async (request, reply) => {
    const { mediaId } = request.params as { mediaId: string }
    const range = typeof request.headers.range === 'string' ? request.headers.range : undefined
    const { asset, object } = await service.openMedia(mediaId, range)
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Cache-Control', 'private, max-age=3600')
    reply.header('Content-Type', object.contentType || asset.mimeType)
    reply.header('Content-Disposition', `inline; filename="${headerFileName(asset.fileName)}"`)
    if (object.contentLength !== null) reply.header('Content-Length', object.contentLength)
    if (object.contentRange) {
      reply.code(206)
      reply.header('Content-Range', object.contentRange)
    }
    return reply.send(object.body)
  })

  app.post('/api/webhooks/evolution/:accountId', async (request, reply) => {
    const configuredSecret =
      process.env.EVOLUTION_WEBHOOK_SECRET ?? 'local-mvp-webhook-secret'
    if (request.headers['x-control-webhook-secret'] !== configuredSecret) {
      return reply.code(401).send({ error: 'Webhook 签名无效' })
    }
    const { accountId } = request.params as { accountId: string }
    await service.handleEvolutionWebhook(accountId, request.body)
    return reply.code(204).send()
  })

  app.get('/api/events', async (request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`)
    const unsubscribe = service.subscribe((event) => {
      reply.raw.write(`event: control\ndata: ${JSON.stringify(event)}\n\n`)
    })
    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 20_000)
    request.raw.on('close', () => {
      clearInterval(keepAlive)
      unsubscribe()
    })
  })

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : '服务处理请求时发生未知错误'
    const statusCode = message === '账号不存在' || message === '媒体不存在' ? 404 : 400
    void reply.code(statusCode).send({ error: message })
  })

  return app
}

async function readUpload(
  request: { file(options?: { limits?: { fileSize?: number } }): Promise<MultipartFile | undefined> },
  purpose: 'message' | 'avatar',
): Promise<{ media: UploadedMedia; part: MultipartFile }> {
  const fileSize = purpose === 'avatar' ? MAX_AVATAR_BYTES : MAX_VIDEO_BYTES
  const part = await request.file({ limits: { fileSize } })
  if (!part) throw new Error('请选择要上传的文件')
  const body = await part.toBuffer()
  const kind = mediaKind(part.mimetype)
  if (purpose === 'avatar' && kind !== 'IMAGE') throw new Error('头像仅支持 JPEG、PNG 或 WebP 图片')
  const limit = kind === 'IMAGE' ? (purpose === 'avatar' ? MAX_AVATAR_BYTES : MAX_IMAGE_BYTES) : MAX_VIDEO_BYTES
  if (body.byteLength > limit) {
    throw new Error(kind === 'IMAGE' ? '图片不能超过 10 MB，头像不能超过 5 MB' : '视频不能超过 64 MB')
  }
  if (!matchesSignature(body, part.mimetype)) throw new Error('文件内容与媒体类型不匹配')
  return {
    part,
    media: {
      body,
      fileName: part.filename || (kind === 'IMAGE' ? 'image.jpg' : 'video.mp4'),
      mimeType: part.mimetype,
      size: body.byteLength,
      kind,
    },
  }
}

function mediaKind(mimeType: string): UploadedMedia['kind'] {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') return 'IMAGE'
  if (mimeType === 'video/mp4') return 'VIDEO'
  throw new Error('仅支持 JPEG、PNG、WebP 图片和 MP4 视频')
}

function matchesSignature(body: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
  if (mimeType === 'image/png') return body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimeType === 'image/webp') return body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP'
  if (mimeType === 'video/mp4') return body.length >= 12 && body.toString('ascii', 4, 8) === 'ftyp'
  return false
}

function multipartField(part: MultipartFile, name: string): string {
  const field = part.fields[name]
  const candidate = Array.isArray(field) ? field[0] : field
  return candidate && candidate.type === 'field' ? String(candidate.value ?? '').trim() : ''
}

function headerFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'media'
}
