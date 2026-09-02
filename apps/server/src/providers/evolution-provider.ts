import type {
  Account,
  AccountStatus,
  MessageStatus,
  ProviderConversation,
  ProviderMedia,
  ProviderMessage,
} from '../domain.js'
import { EvolutionClient } from './evolution-client.js'
import type {
  ProviderHealth,
  ProviderSink,
  SendMediaInput,
  SendResult,
  WhatsAppProvider,
} from './provider.js'

interface EvolutionSession {
  account: Account
  sink: ProviderSink
  stopped: boolean
  lastStatus: AccountStatus | null
  synced: boolean
  hasQr: boolean
  lastConnectAttemptAt: number
}

interface EvolutionProviderOptions {
  client?: EvolutionClient
  webhookBaseUrl?: string
  webhookSecret?: string
  pollIntervalMs?: number
}

export class EvolutionProvider implements WhatsAppProvider {
  readonly mode = 'evolution' as const
  private readonly client: EvolutionClient
  private readonly webhookBaseUrl: string
  private readonly webhookSecret: string
  private readonly pollIntervalMs: number
  private readonly sessions = new Map<string, EvolutionSession>()

  constructor(options: EvolutionProviderOptions = {}) {
    this.client = options.client ?? new EvolutionClient()
    this.webhookBaseUrl = (
      options.webhookBaseUrl ??
      process.env.EVOLUTION_PUBLIC_WEBHOOK_URL ??
      'http://host.docker.internal:4100'
    ).replace(/\/$/, '')
    this.webhookSecret =
      options.webhookSecret ??
      process.env.EVOLUTION_WEBHOOK_SECRET ??
      'local-mvp-webhook-secret'
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000
  }

  async connect(account: Account, sink: ProviderSink): Promise<void> {
    const current = this.sessions.get(account.id)
    if (current) {
      current.account = account
      current.sink = sink
      return
    }
    const session: EvolutionSession = {
      account,
      sink,
      stopped: false,
      lastStatus: null,
      synced: false,
      hasQr: false,
      lastConnectAttemptAt: 0,
    }
    this.sessions.set(account.id, session)
    this.emitStatus(session, 'STARTING')
    void this.run(session).catch((error: unknown) => {
      if (session.stopped) return
      this.emitStatus(session, 'ERROR', errorMessage(error))
    })
  }

  async disconnect(account: Account): Promise<void> {
    const session = this.sessions.get(account.id)
    if (session) {
      session.stopped = true
      this.sessions.delete(account.id)
    }
    try {
      await this.client.logoutInstance(account.evolution.instanceName)
    } catch (error) {
      // Logging out an already closed/deleted instance is idempotent for the control plane.
      if (!isNotFound(error)) throw error
    }
  }

  async deleteInstance(account: Account): Promise<void> {
    const session = this.sessions.get(account.id)
    if (session) {
      session.stopped = true
      this.sessions.delete(account.id)
    }
    try {
      await this.client.deleteInstance(account.evolution.instanceName)
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }

  async sendText(account: Account, conversationId: string, text: string): Promise<SendResult> {
    const result = await this.client.sendText(
      account.evolution.instanceName,
      toEvolutionNumber(conversationId),
      text,
    )
    return { providerMessageId: extractMessageId(result) }
  }

  async sendMedia(
    account: Account,
    conversationId: string,
    input: SendMediaInput,
  ): Promise<SendResult> {
    const result = await this.client.sendMedia(account.evolution.instanceName, {
      number: toEvolutionNumber(conversationId),
      mediatype: input.kind === 'IMAGE' ? 'image' : 'video',
      mimetype: input.mimeType,
      body: input.body,
      caption: input.caption,
      fileName: input.fileName,
    })
    return { providerMessageId: extractMessageId(result) }
  }

  async updateProfilePicture(account: Account, pictureBase64: string): Promise<void> {
    await this.client.updateProfilePicture(account.evolution.instanceName, pictureBase64)
  }

  async removeProfilePicture(account: Account): Promise<void> {
    await this.client.removeProfilePicture(account.evolution.instanceName)
  }

  async handleWebhook(account: Account, payload: unknown): Promise<void> {
    const session = this.sessions.get(account.id)
    if (!session) return
    const event = normalizeEvent(recordString(payload, 'event'))
    const data = recordValue(payload, 'data') ?? payload

    if (event === 'qrcode.updated') {
      const qrDataUrl = extractQrDataUrl(data)
      if (qrDataUrl) {
        session.hasQr = true
        session.sink.onQr(account.id, qrDataUrl)
      }
      this.emitStatus(session, 'QR_REQUIRED')
      return
    }

    if (event === 'connection.update') {
      this.handleConnectionState(session, recordString(data, 'state') ?? recordString(data, 'status'))
      return
    }

    if (event === 'messages.upsert' || event === 'send.message' || event === 'messages.set') {
      for (const item of unwrapArray(data)) await this.emitMessage(session, item)
      return
    }

    if (event === 'messages.update') {
      for (const item of unwrapArray(data)) await this.emitMessage(session, item, true)
      return
    }

    if (event === 'chats.upsert' || event === 'chats.update' || event === 'chats.set') {
      for (const item of unwrapArray(data)) {
        const conversation = normalizeConversation(item)
        if (conversation) session.sink.onConversation(account.id, conversation)
      }
    }
  }

  async health(): Promise<ProviderHealth> {
    try {
      const result = await this.client.health()
      return {
        ok: true,
        endpoint: this.client.baseUrl,
        version: recordString(result, 'version'),
        error: null,
      }
    } catch (error) {
      return {
        ok: false,
        endpoint: this.client.baseUrl,
        version: null,
        error: errorMessage(error),
      }
    }
  }

  private async run(session: EvolutionSession): Promise<void> {
    await this.ensureInstance(session)
    await this.reconcileWebhook(session)

    while (!session.stopped) {
      try {
        const result = await this.client.connectionState(session.account.evolution.instanceName)
        const state = recordString(recordValue(result, 'instance') ?? result, 'state')
        await this.handlePolledState(session, state)
      } catch (error) {
        if (session.stopped) return
        this.emitStatus(session, 'ERROR', errorMessage(error))
      }
      await delay(this.pollIntervalMs)
    }
  }

  private async ensureInstance(session: EvolutionSession): Promise<void> {
    const all = unwrapArray(await this.client.fetchInstances())
    const existing = all.find((item) => instanceNameOf(item) === session.account.evolution.instanceName)
    if (existing) {
      const instanceId = instanceIdOf(existing)
      if (instanceId) session.sink.onInstance(session.account.id, instanceId)
      return
    }

    const created = await this.client.createInstance(session.account.evolution.instanceName)
    const instance = recordValue(created, 'instance') ?? created
    const instanceId = instanceIdOf(instance)
    if (instanceId) session.sink.onInstance(session.account.id, instanceId)
    const qrDataUrl = extractQrDataUrl(recordValue(created, 'qrcode') ?? created)
    if (qrDataUrl) {
      session.hasQr = true
      session.sink.onQr(session.account.id, qrDataUrl)
      this.emitStatus(session, 'QR_REQUIRED')
    }
  }

  private async reconcileWebhook(session: EvolutionSession): Promise<void> {
    await this.client.setWebhook(session.account.evolution.instanceName, {
      url: `${this.webhookBaseUrl}/api/webhooks/evolution/${encodeURIComponent(session.account.id)}`,
      secret: this.webhookSecret,
    })
  }

  private async handlePolledState(session: EvolutionSession, state: string | null): Promise<void> {
    const normalized = state?.toLowerCase()
    if (normalized === 'open') {
      session.hasQr = false
      session.lastConnectAttemptAt = 0
      this.emitStatus(session, 'ONLINE')
      if (!session.synced) {
        session.synced = true
        await this.syncIdentity(session)
        await this.syncRecentData(session)
      }
      return
    }
    session.synced = false
    if (normalized === 'connecting') {
      this.emitStatus(session, session.hasQr ? 'QR_REQUIRED' : 'STARTING')
      return
    }
    const result = await this.requestConnection(session)
    if (result) {
      const qrDataUrl = extractQrDataUrl(result)
      if (qrDataUrl) {
        session.hasQr = true
        session.sink.onQr(session.account.id, qrDataUrl)
      }
    }
    this.emitStatus(session, session.hasQr ? 'QR_REQUIRED' : 'STARTING')
  }

  private async requestConnection(session: EvolutionSession): Promise<unknown | null> {
    const now = Date.now()
    const retryAfterMs = Math.max(this.pollIntervalMs * 3, 15_000)
    if (now - session.lastConnectAttemptAt < retryAfterMs) return null
    session.lastConnectAttemptAt = now
    return this.client.connectInstance(session.account.evolution.instanceName)
  }

  private handleConnectionState(session: EvolutionSession, state: string | null): void {
    const normalized = state?.toLowerCase()
    if (normalized === 'open') {
      session.hasQr = false
      session.lastConnectAttemptAt = 0
      this.emitStatus(session, 'ONLINE')
      return
    }
    if (normalized === 'connecting') {
      this.emitStatus(session, session.hasQr ? 'QR_REQUIRED' : 'STARTING')
      return
    }
    if (normalized === 'close' || normalized === 'closed') {
      session.synced = false
      this.emitStatus(session, 'QR_REQUIRED')
    }
  }

  private async syncRecentData(session: EvolutionSession): Promise<void> {
    try {
      const chats = unwrapArray(await this.client.findChats(session.account.evolution.instanceName))
      const normalizedChats = chats
        .map(normalizeConversation)
        .filter((item): item is ProviderConversation => item !== null)
      for (const chat of normalizedChats) session.sink.onConversation(session.account.id, chat)

      const batches = await Promise.allSettled(
        normalizedChats.slice(0, 12).map(async (chat) => ({
          chat,
          messages: unwrapArray(
            await this.client.findMessages(session.account.evolution.instanceName, chat.id),
          ),
        })),
      )
      for (const batch of batches) {
        if (batch.status !== 'fulfilled') continue
        for (const item of batch.value.messages.reverse()) await this.emitMessage(session, item)
      }
    } catch {
      // Webhooks continue to provide live data when history sync is unavailable.
    }
  }

  private async syncIdentity(session: EvolutionSession): Promise<void> {
    try {
      const instances = unwrapArray(await this.client.fetchInstances())
      const instance = instances.find(
        (item) => instanceNameOf(item) === session.account.evolution.instanceName,
      )
      const ownerJid =
        recordString(instance, 'ownerJid') ??
        recordString(instance, 'number') ??
        recordString(recordValue(instance, 'instance'), 'ownerJid')
      if (ownerJid) session.sink.onIdentity(session.account.id, displayJid(ownerJid))
    } catch {
      // Identity is informational; connection and messaging remain available.
    }
  }

  private async emitMessage(session: EvolutionSession, input: unknown, updateOnly = false): Promise<void> {
    let message = normalizeMessage(input, updateOnly)
    if (!message) return
    if (message.media && !message.media.base64 && !updateOnly) {
      try {
        const downloaded = await this.client.getBase64FromMediaMessage(
          session.account.evolution.instanceName,
          input,
        )
        message = {
          ...message,
          media: {
            ...message.media,
            mimeType: recordString(downloaded, 'mimetype') ?? message.media.mimeType,
            fileName: recordString(downloaded, 'fileName') ?? message.media.fileName,
            size: extractMediaSize(downloaded) || message.media.size,
            base64: normalizeBase64(recordString(downloaded, 'base64')),
          },
        }
      } catch {
        // Keep the message and caption visible even if Evolution cannot decrypt the media.
      }
    }
    const pushName = recordString(input, 'pushName')
    if (pushName) {
      session.sink.onConversation(session.account.id, {
        id: message.conversationId,
        title: pushName,
        subtitle: displayJid(message.conversationId),
        isGroup: message.conversationId.endsWith('@g.us'),
      })
    }
    await session.sink.onMessage(session.account.id, message)
  }

  private emitStatus(session: EvolutionSession, status: AccountStatus, error: string | null = null): void {
    if (session.lastStatus === status && status !== 'ERROR') return
    session.lastStatus = status
    session.sink.onStatus(session.account.id, status, error)
  }
}

function normalizeConversation(input: unknown): ProviderConversation | null {
  const id =
    recordString(input, 'remoteJid') ??
    recordString(input, 'id') ??
    recordString(recordValue(input, 'key'), 'remoteJid')
  if (!id || id === 'status@broadcast') return null
  const lastMessage = recordValue(input, 'lastMessage')
  return {
    id,
    title:
      recordString(input, 'name') ??
      recordString(input, 'pushName') ??
      recordString(input, 'subject') ??
      displayJid(id),
    subtitle: displayJid(id),
    lastMessagePreview: extractText(lastMessage ?? input),
    lastMessageAt: toIso(
      recordValue(input, 'updatedAt') ??
        recordValue(input, 'messageTimestamp') ??
        recordValue(lastMessage, 'messageTimestamp'),
    ),
    unreadCount: recordNumber(input, 'unreadMessages') ?? recordNumber(input, 'unreadCount') ?? 0,
    isGroup: id.endsWith('@g.us'),
  }
}

function normalizeMessage(input: unknown, updateOnly: boolean): ProviderMessage | null {
  const key = recordValue(input, 'key') ?? recordValue(recordValue(input, 'message'), 'key')
  const conversationId =
    recordString(key, 'remoteJid') ??
    recordString(input, 'remoteJid') ??
    recordString(input, 'conversationId')
  if (!conversationId || conversationId === 'status@broadcast') return null
  const fromMe = recordBoolean(key, 'fromMe') ?? recordBoolean(input, 'fromMe') ?? false
  const media = extractMedia(input)
  const extractedBody = extractText(recordValue(input, 'message') ?? input)
  const body = extractedBody || (media?.kind === 'IMAGE' ? '[图片]' : media?.kind === 'VIDEO' ? '[视频]' : '')
  if (!body && !updateOnly) return null
  return {
    providerMessageId: recordString(key, 'id') ?? recordString(input, 'id'),
    conversationId,
    direction: fromMe ? 'OUT' : 'IN',
    kind: media?.kind ?? 'TEXT',
    body,
    media,
    createdAt: toIso(recordValue(input, 'messageTimestamp') ?? recordValue(input, 'timestamp')),
    status: mapMessageStatus(fromMe, recordValue(input, 'status') ?? recordValue(input, 'update')),
  }
}

function extractMedia(input: unknown): ProviderMedia | null {
  const message = unwrapMessage(recordValue(input, 'message') ?? input)
  if (!isRecord(message)) return null
  const definitions = [
    ['imageMessage', 'IMAGE', 'image.jpg'],
    ['videoMessage', 'VIDEO', 'video.mp4'],
  ] as const
  for (const [field, kind, fallbackName] of definitions) {
    const value = message[field]
    if (!isRecord(value)) continue
    return {
      kind,
      mimeType:
        recordString(value, 'mimetype') ??
        recordString(value, 'mime_type') ??
        (kind === 'IMAGE' ? 'image/jpeg' : 'video/mp4'),
      fileName: recordString(value, 'fileName') ?? fallbackName,
      size: recordNumber(value, 'fileLength') ?? 0,
      base64: normalizeBase64(
        recordString(message, 'base64') ??
          recordString(input, 'base64') ??
          recordString(value, 'base64'),
      ),
    }
  }
  return null
}

function unwrapMessage(input: unknown): unknown {
  let current = input
  for (let index = 0; index < 5 && isRecord(current); index += 1) {
    if (isRecord(current.imageMessage) || isRecord(current.videoMessage)) return current
    const wrapper =
      current.ephemeralMessage ??
      current.viewOnceMessage ??
      current.viewOnceMessageV2 ??
      current.viewOnceMessageV2Extension ??
      current.documentWithCaptionMessage
    if (!isRecord(wrapper)) return current
    current = recordValue(wrapper, 'message') ?? wrapper
  }
  return current
}

function normalizeBase64(value: string | null): string | null {
  if (!value) return null
  const marker = value.indexOf('base64,')
  return marker === -1 ? value : value.slice(marker + 7)
}

function extractMediaSize(input: unknown): number {
  const size = recordValue(input, 'size')
  if (isRecord(size)) return recordNumber(size, 'fileLength') ?? 0
  return recordNumber(input, 'fileLength') ?? 0
}

function extractText(input: unknown): string {
  if (typeof input === 'string') return input
  if (!isRecord(input)) return ''
  const direct = input.conversation ?? input.text ?? input.caption ?? input.body
  if (typeof direct === 'string') return direct
  for (const key of [
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'documentMessage',
    'buttonsResponseMessage',
    'listResponseMessage',
  ]) {
    const nested = input[key]
    if (!isRecord(nested)) continue
    const value = nested.text ?? nested.caption ?? nested.title ?? nested.selectedDisplayText
    if (typeof value === 'string') return value
  }
  const messageType = Object.keys(input).find((key) => key.endsWith('Message'))
  return messageType ? `[${messageType.replace(/Message$/, '')}]` : ''
}

function mapMessageStatus(fromMe: boolean, input: unknown): MessageStatus {
  if (!fromMe) return 'RECEIVED'
  const value = typeof input === 'string' ? input.toUpperCase() : String(input ?? '').toUpperCase()
  if (value.includes('READ') || value === '4') return 'READ'
  if (value.includes('DELIVER') || value === '3') return 'DELIVERED'
  if (value.includes('ERROR') || value.includes('FAIL')) return 'FAILED'
  return 'SENT'
}

function extractQrDataUrl(input: unknown): string | null {
  const candidates = [
    recordString(input, 'base64'),
    recordString(recordValue(input, 'qrcode'), 'base64'),
    recordString(recordValue(input, 'data'), 'base64'),
    recordString(recordValue(recordValue(input, 'data'), 'qrcode'), 'base64'),
  ]
  const value = candidates.find(Boolean)
  if (!value) return null
  return value.startsWith('data:image/') ? value : `data:image/png;base64,${value}`
}

function extractMessageId(input: unknown): string | null {
  return (
    recordString(recordValue(input, 'key'), 'id') ??
    recordString(recordValue(recordValue(input, 'message'), 'key'), 'id') ??
    recordString(input, 'id')
  )
}

function instanceNameOf(input: unknown): string | null {
  return (
    recordString(input, 'name') ??
    recordString(input, 'instanceName') ??
    recordString(recordValue(input, 'instance'), 'instanceName')
  )
}

function instanceIdOf(input: unknown): string | null {
  return (
    recordString(input, 'id') ??
    recordString(input, 'instanceId') ??
    recordString(recordValue(input, 'instance'), 'instanceId')
  )
}

function unwrapArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!isRecord(input)) return []
  for (const candidate of [
    input.records,
    input.chats,
    input.data,
    input.messages,
    isRecord(input.messages) ? input.messages.records : undefined,
  ]) {
    if (Array.isArray(candidate)) return candidate
  }
  return [input]
}

function toEvolutionNumber(conversationId: string): string {
  if (conversationId.endsWith('@g.us')) return conversationId
  return conversationId.replace(/@(s\.whatsapp\.net|c\.us)$/, '')
}

function displayJid(value: string): string {
  const bare = value.replace(/@(s\.whatsapp\.net|c\.us|g\.us)$/, '')
  return /^\d+$/.test(bare) ? `+${bare}` : bare
}

function normalizeEvent(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replaceAll('_', '.')
}

function toIso(value: unknown): string {
  if (typeof value === 'string' && /[T-]/.test(value)) {
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString()
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date().toISOString()
  return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString()
}

function recordValue(input: unknown, key: string): unknown {
  return isRecord(input) ? input[key] : undefined
}

function recordString(input: unknown, key: string): string | null {
  const value = recordValue(input, key)
  return typeof value === 'string' && value ? value : null
}

function recordNumber(input: unknown, key: string): number | null {
  const value = recordValue(input, key)
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function recordBoolean(input: unknown, key: string): boolean | null {
  const value = recordValue(input, key)
  return typeof value === 'boolean' ? value : null
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Evolution API 操作失败'
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.status === 404
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
