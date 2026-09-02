import type {
  Account,
  AccountStatus,
  ProviderConversation,
  ProviderMedia,
  ProviderMessage,
} from '../domain.js'

export interface ProviderSink {
  onStatus(accountId: string, status: AccountStatus, error?: string | null): void
  onQr(accountId: string, qrDataUrl: string): void
  onIdentity(accountId: string, phone: string): void
  onInstance(accountId: string, instanceId: string): void
  onConversation(accountId: string, conversation: ProviderConversation): void
  onMessage(accountId: string, message: ProviderMessage): Promise<void> | void
}

export interface SendResult {
  providerMessageId: string | null
}

export interface SendMediaInput extends Omit<ProviderMedia, 'base64' | 'size'> {
  body: Buffer
  caption: string
}

export interface ProviderHealth {
  ok: boolean
  endpoint: string
  version: string | null
  error: string | null
}

export interface WhatsAppProvider {
  readonly mode: 'evolution'
  connect(account: Account, sink: ProviderSink): Promise<void>
  disconnect(account: Account): Promise<void>
  deleteInstance(account: Account): Promise<void>
  sendText(account: Account, conversationId: string, text: string): Promise<SendResult>
  sendMedia(account: Account, conversationId: string, input: SendMediaInput): Promise<SendResult>
  updateProfilePicture(account: Account, pictureBase64: string): Promise<void>
  removeProfilePicture(account: Account): Promise<void>
  handleWebhook(account: Account, payload: unknown): Promise<void>
  health(): Promise<ProviderHealth>
}
