export type ProviderMode = 'evolution'
export type AccountStatus = 'OFFLINE' | 'STARTING' | 'QR_REQUIRED' | 'ONLINE' | 'ERROR'
export type MessageStatus = 'RECEIVED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
export type MessageKind = 'TEXT' | 'IMAGE' | 'VIDEO'

export interface EvolutionInstance {
  instanceName: string
  instanceId: string | null
  integration: 'WHATSAPP-BAILEYS'
}

export interface Account {
  id: string
  name: string
  phone: string | null
  status: AccountStatus
  providerMode: ProviderMode
  lastSeenAt: string | null
  qrDataUrl: string | null
  avatarUrl: string | null
  avatarMediaId: string | null
  error: string | null
  evolution: EvolutionInstance
  createdAt: string
}

export interface Conversation {
  id: string
  accountId: string
  title: string
  subtitle: string
  lastMessagePreview: string
  lastMessageAt: string
  unreadCount: number
  isGroup: boolean
  avatarTone: string
}

export interface Message {
  id: string
  providerMessageId: string | null
  clientRef: string | null
  accountId: string
  conversationId: string
  direction: 'IN' | 'OUT'
  kind: MessageKind
  body: string
  media: MediaAttachment | null
  status: MessageStatus
  createdAt: string
}

export interface MediaAttachment {
  id: string
  kind: 'IMAGE' | 'VIDEO'
  url: string
  mimeType: string
  fileName: string
  size: number
}

export type ControlEvent =
  | { type: 'account.updated'; data: Account }
  | { type: 'account.deleted'; data: { id: string } }
  | { type: 'conversation.updated'; data: Conversation }
  | { type: 'message.created'; data: Message }
  | { type: 'message.updated'; data: Message }
