import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import type {
  Account,
  AccountStatus,
  ControlEvent,
  Conversation,
  MediaAsset,
  MediaAttachment,
  MediaKind,
  Message,
  MessageKind,
  ProviderConversation,
  ProviderMessage,
} from './domain.js'
import { EvolutionProvider } from './providers/evolution-provider.js'
import type { ProviderSink, WhatsAppProvider } from './providers/provider.js'
import { S3MediaStorage, type MediaStorage, type StoredMediaObject } from './media-storage.js'
import { JsonStateStore, type StateStore } from './state-store.js'

interface ControlCenterOptions {
  provider?: WhatsAppProvider
  store?: StateStore
  mediaStorage?: MediaStorage
}

export interface UploadedMedia {
  body: Buffer
  fileName: string
  mimeType: string
  size: number
  kind: Exclude<MediaKind, 'AVATAR'>
}

export class ControlCenterService {
  private readonly accounts = new Map<string, Account>()
  private readonly conversations = new Map<string, Conversation>()
  private readonly messages = new Map<string, Message>()
  private readonly mediaAssets = new Map<string, MediaAsset>()
  private readonly eventBus = new EventEmitter()
  private readonly provider: WhatsAppProvider
  private readonly store: StateStore
  private readonly mediaStorage: MediaStorage
  private readonly accountOperations = new Map<string, Promise<void>>()
  private readonly avatarOperations = new Map<
    string,
    { fingerprint: string; promise: Promise<Account> }
  >()

  constructor(options: ControlCenterOptions = {}) {
    this.provider = options.provider ?? new EvolutionProvider()
    this.store = options.store ?? new JsonStateStore()
    this.mediaStorage = options.mediaStorage ?? new S3MediaStorage()
    const state = this.store.load()
    for (const account of state.accounts) {
      this.accounts.set(account.id, {
        ...account,
        providerMode: 'evolution',
        status: 'OFFLINE',
        qrDataUrl: null,
        avatarUrl: account.avatarUrl ?? null,
        avatarMediaId: account.avatarMediaId ?? null,
        error: null,
        evolution: evolutionMetadata(account),
      })
    }
    for (const conversation of state.conversations) {
      this.conversations.set(conversationKey(conversation.accountId, conversation.id), conversation)
    }
    for (const message of state.messages) {
      this.messages.set(message.id, {
        ...message,
        kind: message.kind ?? 'TEXT',
        media: message.media ?? null,
      })
    }
    for (const asset of state.mediaAssets) this.mediaAssets.set(asset.id, asset)
    if (state.accounts.length > 0) this.persist()
  }

  readonly sink: ProviderSink = {
    onStatus: (accountId, status, error = null) => this.updateAccountStatus(accountId, status, error),
    onQr: (accountId, qrDataUrl) => {
      const account = this.requireAccount(accountId)
      this.saveAccount({ ...account, qrDataUrl, error: null })
    },
    onIdentity: (accountId, phone) => {
      const account = this.requireAccount(accountId)
      this.saveAccount({ ...account, phone })
    },
    onInstance: (accountId, instanceId) => {
      const account = this.requireAccount(accountId)
      this.saveAccount({
        ...account,
        evolution: { ...account.evolution, instanceId },
      })
    },
    onConversation: (accountId, conversation) => this.upsertProviderConversation(accountId, conversation),
    onMessage: (accountId, message) => this.upsertProviderMessage(accountId, message),
  }

  listAccounts(): Account[] {
    return [...this.accounts.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  createAccount(input: { name: string }): Account {
    const name = input.name.trim()
    if (!name) throw new Error('账号名称不能为空')
    const id = crypto.randomUUID()
    const account: Account = {
      id,
      name,
      phone: null,
      status: 'OFFLINE',
      providerMode: 'evolution',
      lastSeenAt: null,
      qrDataUrl: null,
      avatarUrl: null,
      avatarMediaId: null,
      error: null,
      evolution: {
        instanceName: instanceNameFor(id),
        instanceId: null,
        integration: 'WHATSAPP-BAILEYS',
      },
      createdAt: new Date().toISOString(),
    }
    this.saveAccount(account)
    return account
  }

  async resumeSessions(): Promise<void> {
    if (process.env.EVOLUTION_AUTO_RESUME === 'false') return
    await Promise.allSettled(this.listAccounts().map((account) => this.connectAccount(account.id)))
  }

  async connectAccount(accountId: string): Promise<Account> {
    const account = this.requireAccount(accountId)
    await this.provider.connect(account, this.sink)
    return this.requireAccount(accountId)
  }

  async disconnectAccount(accountId: string): Promise<Account> {
    const account = this.requireAccount(accountId)
    await this.provider.disconnect(account)
    this.updateAccountStatus(accountId, 'OFFLINE')
    return this.requireAccount(accountId)
  }

  async deleteAccount(accountId: string): Promise<{ id: string }> {
    const account = this.requireAccount(accountId)
    await this.runAccountOperation(accountId, () => this.provider.deleteInstance(account))

    const assets = [...this.mediaAssets.values()].filter((asset) => asset.accountId === accountId)
    this.accounts.delete(accountId)
    for (const [key, conversation] of this.conversations) {
      if (conversation.accountId === accountId) this.conversations.delete(key)
    }
    for (const [id, message] of this.messages) {
      if (message.accountId === accountId) this.messages.delete(id)
    }
    for (const asset of assets) this.mediaAssets.delete(asset.id)
    this.persist()
    this.publish({ type: 'account.deleted', data: { id: accountId } })
    await Promise.allSettled(assets.map((asset) => this.mediaStorage.delete(asset.storageKey)))
    return { id: accountId }
  }

  listConversations(accountId: string): Conversation[] {
    this.requireAccount(accountId)
    return [...this.conversations.values()]
      .filter((conversation) => conversation.accountId === accountId)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
  }

  createConversation(accountId: string, input: { target: string; name?: string }): Conversation {
    this.requireAccount(accountId)
    const conversationId = normalizeTarget(input.target)
    const key = conversationKey(accountId, conversationId)
    const existing = this.conversations.get(key)
    if (existing) return existing
    const conversation: Conversation = {
      id: conversationId,
      accountId,
      title: input.name?.trim() || displayTarget(conversationId),
      subtitle: displayTarget(conversationId),
      lastMessagePreview: '新建会话',
      lastMessageAt: new Date().toISOString(),
      unreadCount: 0,
      isGroup: conversationId.endsWith('@g.us'),
      avatarTone: toneFor(conversationId),
    }
    this.saveConversation(conversation)
    return conversation
  }

  listMessages(accountId: string, conversationId: string): Message[] {
    this.requireAccount(accountId)
    return [...this.messages.values()]
      .filter(
        (message) => message.accountId === accountId && message.conversationId === conversationId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async sendMessage(
    accountId: string,
    conversationId: string,
    input: { text: string; clientRef?: string },
  ): Promise<Message> {
    const account = this.requireAccount(accountId)
    if (account.status !== 'ONLINE') throw new Error('账号当前不在线')
    const text = input.text.trim()
    if (!text) throw new Error('消息内容不能为空')
    if (text.length > 4096) throw new Error('消息长度不能超过 4096 字符')
    const clientRef = input.clientRef?.trim() || null
    if (clientRef) {
      const existing = [...this.messages.values()].find(
        (message) => message.accountId === accountId && message.clientRef === clientRef,
      )
      if (existing) return existing
    }

    this.ensureConversation(accountId, conversationId)
    let message: Message = {
      id: crypto.randomUUID(),
      providerMessageId: null,
      clientRef,
      accountId,
      conversationId,
      direction: 'OUT',
      kind: 'TEXT',
      body: text,
      media: null,
      status: 'SENDING',
      createdAt: new Date().toISOString(),
    }
    this.messages.set(message.id, message)
    this.persist()
    this.publish({ type: 'message.created', data: message })
    this.touchConversation(accountId, conversationId, text, false)

    try {
      const result = await this.runAccountOperation(accountId, () =>
        this.provider.sendText(account, conversationId, text),
      )
      message = { ...message, providerMessageId: result.providerMessageId, status: 'SENT' }
      this.messages.set(message.id, message)
      this.persist()
      this.publish({ type: 'message.updated', data: message })
      return message
    } catch (error) {
      message = { ...message, status: 'FAILED' }
      this.messages.set(message.id, message)
      this.persist()
      this.publish({ type: 'message.updated', data: message })
      throw error
    }
  }

  async sendMediaMessage(
    accountId: string,
    conversationId: string,
    input: UploadedMedia & { caption: string; clientRef?: string },
  ): Promise<Message> {
    const account = this.requireAccount(accountId)
    if (account.status !== 'ONLINE') throw new Error('账号当前不在线')
    const caption = input.caption.trim()
    if (caption.length > 1024) throw new Error('媒体说明不能超过 1024 字符')
    const clientRef = input.clientRef?.trim() || null
    if (clientRef) {
      const existing = [...this.messages.values()].find(
        (message) => message.accountId === accountId && message.clientRef === clientRef,
      )
      if (existing) return existing
    }

    this.ensureConversation(accountId, conversationId)
    const asset = await this.storeMedia(accountId, input.kind, input)
    const attachment = mediaAttachment(asset)
    const preview = caption || mediaLabel(input.kind)
    let message: Message = {
      id: crypto.randomUUID(),
      providerMessageId: null,
      clientRef,
      accountId,
      conversationId,
      direction: 'OUT',
      kind: input.kind,
      body: preview,
      media: attachment,
      status: 'SENDING',
      createdAt: new Date().toISOString(),
    }
    this.messages.set(message.id, message)
    this.persist()
    this.publish({ type: 'message.created', data: message })
    this.touchConversation(accountId, conversationId, preview, false)

    try {
      const result = await this.runAccountOperation(accountId, () =>
        this.provider.sendMedia(account, conversationId, {
          kind: input.kind,
          mimeType: input.mimeType,
          fileName: input.fileName,
          body: input.body,
          caption,
        }),
      )
      message = { ...message, providerMessageId: result.providerMessageId, status: 'SENT' }
      this.messages.set(message.id, message)
      this.persist()
      this.publish({ type: 'message.updated', data: message })
      return message
    } catch (error) {
      message = { ...message, status: 'FAILED' }
      this.messages.set(message.id, message)
      this.persist()
      this.publish({ type: 'message.updated', data: message })
      throw error
    }
  }

  async updateAccountAvatar(
    accountId: string,
    input: Omit<UploadedMedia, 'kind'>,
  ): Promise<Account> {
    const fingerprint = createHash('sha256').update(input.body).digest('hex')
    const activeOperation = this.avatarOperations.get(accountId)
    if (activeOperation?.fingerprint === fingerprint) return activeOperation.promise

    const promise = this.performAccountAvatarUpdate(accountId, input)
    const operation = { fingerprint, promise }
    this.avatarOperations.set(accountId, operation)
    try {
      return await promise
    } finally {
      if (this.avatarOperations.get(accountId) === operation) this.avatarOperations.delete(accountId)
    }
  }

  private async performAccountAvatarUpdate(
    accountId: string,
    input: Omit<UploadedMedia, 'kind'>,
  ): Promise<Account> {
    const account = this.requireAccount(accountId)
    if (account.status !== 'ONLINE') throw new Error('账号当前不在线')
    const asset = await this.storeMedia(accountId, 'AVATAR', input)
    try {
      await this.runAccountOperation(accountId, () =>
        this.provider.updateProfilePicture(account, input.body.toString('base64')),
      )
    } catch (error) {
      this.mediaAssets.delete(asset.id)
      await this.mediaStorage.delete(asset.storageKey).catch(() => undefined)
      this.persist()
      throw error
    }

    const previousAsset = account.avatarMediaId
      ? this.mediaAssets.get(account.avatarMediaId) ?? null
      : null
    const updated = {
      ...account,
      avatarMediaId: asset.id,
      avatarUrl: `/api/media/${encodeURIComponent(asset.id)}`,
    }
    this.saveAccount(updated)
    if (previousAsset) {
      this.mediaAssets.delete(previousAsset.id)
      await this.mediaStorage.delete(previousAsset.storageKey).catch(() => undefined)
      this.persist()
    }
    return updated
  }

  async removeAccountAvatar(accountId: string): Promise<Account> {
    const account = this.requireAccount(accountId)
    if (account.status !== 'ONLINE') throw new Error('账号当前不在线')
    await this.runAccountOperation(accountId, () => this.provider.removeProfilePicture(account))
    const previousAsset = account.avatarMediaId
      ? this.mediaAssets.get(account.avatarMediaId) ?? null
      : null
    const updated = { ...account, avatarMediaId: null, avatarUrl: null }
    this.saveAccount(updated)
    if (previousAsset) {
      this.mediaAssets.delete(previousAsset.id)
      await this.mediaStorage.delete(previousAsset.storageKey).catch(() => undefined)
      this.persist()
    }
    return updated
  }

  async openMedia(mediaId: string, range?: string): Promise<{ asset: MediaAsset; object: StoredMediaObject }> {
    const asset = this.mediaAssets.get(mediaId)
    if (!asset) throw new Error('媒体不存在')
    return { asset, object: await this.mediaStorage.get(asset.storageKey, range) }
  }

  async handleEvolutionWebhook(accountId: string, payload: unknown): Promise<void> {
    const account = this.requireAccount(accountId)
    await this.provider.handleWebhook(account, payload)
  }

  getProviderHealth() {
    return this.provider.health()
  }

  subscribe(listener: (event: ControlEvent) => void): () => void {
    this.eventBus.on('control-event', listener)
    return () => this.eventBus.off('control-event', listener)
  }

  private updateAccountStatus(accountId: string, status: AccountStatus, error: string | null = null): void {
    const account = this.requireAccount(accountId)
    this.saveAccount({
      ...account,
      status,
      error,
      qrDataUrl: status === 'ONLINE' || status === 'OFFLINE' ? null : account.qrDataUrl,
      lastSeenAt: status === 'ONLINE' ? new Date().toISOString() : account.lastSeenAt,
    })
  }

  private upsertProviderConversation(accountId: string, input: ProviderConversation): Conversation {
    const key = conversationKey(accountId, input.id)
    const existing = this.conversations.get(key)
    const conversation: Conversation = {
      id: input.id,
      accountId,
      title: input.title || existing?.title || displayTarget(input.id),
      subtitle: input.subtitle ?? existing?.subtitle ?? displayTarget(input.id),
      lastMessagePreview: input.lastMessagePreview ?? existing?.lastMessagePreview ?? '',
      lastMessageAt: input.lastMessageAt ?? existing?.lastMessageAt ?? new Date().toISOString(),
      unreadCount: input.unreadCount ?? existing?.unreadCount ?? 0,
      isGroup: input.isGroup ?? existing?.isGroup ?? input.id.endsWith('@g.us'),
      avatarTone: existing?.avatarTone ?? toneFor(input.id),
    }
    this.saveConversation(conversation)
    return conversation
  }

  private async upsertProviderMessage(accountId: string, input: ProviderMessage): Promise<void> {
    if (input.providerMessageId) {
      const existing = [...this.messages.values()].find(
        (message) =>
          message.accountId === accountId && message.providerMessageId === input.providerMessageId,
      )
      if (existing) {
        const incomingMedia = existing.media ? null : await this.storeProviderMedia(accountId, input)
        const updated = {
          ...existing,
          status: input.status,
          body: input.body || existing.body,
          kind: input.kind === 'TEXT' ? existing.kind : input.kind,
          media: incomingMedia ?? existing.media,
        }
        this.messages.set(updated.id, updated)
        this.persist()
        this.publish({ type: 'message.updated', data: updated })
        return
      }
    }

    const media = await this.storeProviderMedia(accountId, input)
    this.ensureConversation(accountId, input.conversationId)
    const message: Message = {
      id: crypto.randomUUID(),
      providerMessageId: input.providerMessageId,
      clientRef: null,
      accountId,
      conversationId: input.conversationId,
      direction: input.direction,
      kind: input.kind,
      body: input.body,
      media,
      status: input.status,
      createdAt: input.createdAt,
    }
    this.messages.set(message.id, message)
    this.persist()
    this.publish({ type: 'message.created', data: message })
    this.touchConversation(accountId, input.conversationId, input.body, input.direction === 'IN')
  }

  private async storeProviderMedia(
    accountId: string,
    input: ProviderMessage,
  ): Promise<MediaAttachment | null> {
    if (!input.media?.base64) return null
    return mediaAttachment(
      await this.storeMedia(accountId, input.media.kind, {
        body: decodeBase64(input.media.base64),
        fileName: input.media.fileName,
        mimeType: input.media.mimeType,
        size: input.media.size,
      }),
    )
  }

  private async storeMedia(
    accountId: string,
    kind: MediaKind,
    input: { body: Buffer; fileName: string; mimeType: string; size: number },
  ): Promise<MediaAsset> {
    const id = crypto.randomUUID()
    const storageKey = await this.mediaStorage.put({
      id,
      accountId,
      kind,
      fileName: input.fileName,
      mimeType: input.mimeType,
      body: input.body,
    })
    const asset: MediaAsset = {
      id,
      accountId,
      kind,
      storageKey,
      mimeType: input.mimeType,
      fileName: input.fileName,
      size: input.size || input.body.byteLength,
      createdAt: new Date().toISOString(),
    }
    this.mediaAssets.set(id, asset)
    this.persist()
    return asset
  }

  private async runAccountOperation<T>(accountId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.accountOperations.get(accountId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(action)
    const tail = operation.then(
      () => undefined,
      () => undefined,
    )
    this.accountOperations.set(accountId, tail)
    try {
      return await operation
    } finally {
      if (this.accountOperations.get(accountId) === tail) this.accountOperations.delete(accountId)
    }
  }

  private ensureConversation(accountId: string, conversationId: string): Conversation {
    const key = conversationKey(accountId, conversationId)
    const existing = this.conversations.get(key)
    if (existing) return existing
    return this.createConversation(accountId, { target: conversationId })
  }

  private touchConversation(
    accountId: string,
    conversationId: string,
    preview: string,
    incrementUnread: boolean,
  ): void {
    const conversation = this.ensureConversation(accountId, conversationId)
    this.saveConversation({
      ...conversation,
      lastMessagePreview: preview,
      lastMessageAt: new Date().toISOString(),
      unreadCount: conversation.unreadCount + (incrementUnread ? 1 : 0),
    })
  }

  private saveAccount(account: Account): void {
    this.accounts.set(account.id, account)
    this.persist()
    this.publish({ type: 'account.updated', data: account })
  }

  private saveConversation(conversation: Conversation): void {
    this.conversations.set(conversationKey(conversation.accountId, conversation.id), conversation)
    this.persist()
    this.publish({ type: 'conversation.updated', data: conversation })
  }

  private persist(): void {
    this.store.save({
      accounts: [...this.accounts.values()],
      conversations: [...this.conversations.values()],
      messages: [...this.messages.values()],
      mediaAssets: [...this.mediaAssets.values()],
    })
  }

  private publish(event: ControlEvent): void {
    this.eventBus.emit('control-event', event)
  }

  private requireAccount(accountId: string): Account {
    const account = this.accounts.get(accountId)
    if (!account) throw new Error('账号不存在')
    return account
  }
}

function normalizeTarget(target: string): string {
  const trimmed = target.trim()
  if (
    trimmed.endsWith('@s.whatsapp.net') ||
    trimmed.endsWith('@c.us') ||
    trimmed.endsWith('@g.us')
  ) {
    return trimmed.replace(/@c\.us$/, '@s.whatsapp.net')
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 20) throw new Error('请输入含国家区号的有效号码')
  return `${digits}@s.whatsapp.net`
}

function displayTarget(target: string): string {
  return `+${target.replace(/@(s\.whatsapp\.net|c\.us|g\.us)$/, '')}`
}

function conversationKey(accountId: string, conversationId: string): string {
  return `${accountId}::${conversationId}`
}

function toneFor(value: string): string {
  const tones = ['amber', 'mint', 'blue', 'rose']
  const hash = [...value].reduce((total, char) => total + char.charCodeAt(0), 0)
  return tones[hash % tones.length]!
}

function instanceNameFor(accountId: string): string {
  return `wa_${accountId.replaceAll('-', '')}`
}

function evolutionMetadata(account: Account): Account['evolution'] {
  const value = (account as Account & { evolution?: Partial<Account['evolution']> }).evolution
  return {
    instanceName: value?.instanceName ?? instanceNameFor(account.id),
    instanceId: value?.instanceId ?? null,
    integration: 'WHATSAPP-BAILEYS',
  }
}

function mediaAttachment(asset: MediaAsset): MediaAttachment {
  if (asset.kind === 'AVATAR') throw new Error('头像不能作为消息附件')
  return {
    id: asset.id,
    kind: asset.kind,
    url: `/api/media/${encodeURIComponent(asset.id)}`,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    size: asset.size,
  }
}

function mediaLabel(kind: Exclude<MediaKind, 'AVATAR'>): string {
  return kind === 'IMAGE' ? '[图片]' : '[视频]'
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '')
  const buffer = Buffer.from(normalized, 'base64')
  if (buffer.byteLength === 0) throw new Error('收到的媒体内容为空')
  return buffer
}
