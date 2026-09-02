import type { Account, Conversation, Message } from '@/types'
import {
  controlApiUrl,
  normalizeAccountUrls,
  normalizeMessageUrls,
} from './runtime-config.js'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = init?.body !== undefined && !(init.body instanceof FormData)
  const response = await fetch(controlApiUrl(path), {
    ...init,
    headers: {
      ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? `请求失败 (${response.status})`)
  }
  return response.json() as Promise<T>
}

export const controlCenterApi = {
  async listAccounts(): Promise<Account[]> {
    const result = await request<{ items: Account[] }>('/api/accounts')
    return result.items.map(normalizeAccountUrls)
  },
  createAccount(name: string): Promise<Account> {
    return request<Account>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }).then(normalizeAccountUrls)
  },
  connectAccount(accountId: string): Promise<Account> {
    return request<Account>(`/api/accounts/${encodeURIComponent(accountId)}/connect`, { method: 'POST' })
      .then(normalizeAccountUrls)
  },
  disconnectAccount(accountId: string): Promise<Account> {
    return request<Account>(`/api/accounts/${encodeURIComponent(accountId)}/disconnect`, { method: 'POST' })
      .then(normalizeAccountUrls)
  },
  deleteAccount(accountId: string): Promise<{ id: string }> {
    return request(`/api/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' })
  },
  async listConversations(accountId: string): Promise<Conversation[]> {
    const result = await request<{ items: Conversation[] }>(
      `/api/accounts/${encodeURIComponent(accountId)}/conversations`,
    )
    return result.items
  },
  createConversation(accountId: string, target: string, name?: string): Promise<Conversation> {
    return request(`/api/accounts/${encodeURIComponent(accountId)}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ target, name }),
    })
  },
  async listMessages(accountId: string, conversationId: string): Promise<Message[]> {
    const result = await request<{ items: Message[] }>(
      `/api/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    )
    return result.items.map(normalizeMessageUrls)
  },
  sendMessage(accountId: string, conversationId: string, text: string): Promise<Message> {
    return request<Message>(
      `/api/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ text, clientRef: crypto.randomUUID() }),
      },
    ).then(normalizeMessageUrls)
  },
  sendMedia(
    accountId: string,
    conversationId: string,
    file: File,
    caption: string,
  ): Promise<Message> {
    const form = new FormData()
    form.append('caption', caption)
    form.append('clientRef', crypto.randomUUID())
    form.append('file', file, file.name)
    return request<Message>(
      `/api/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/media`,
      { method: 'POST', body: form },
    ).then(normalizeMessageUrls)
  },
  updateAvatar(accountId: string, file: File): Promise<Account> {
    const form = new FormData()
    form.append('file', file, file.name)
    return request<Account>(`/api/accounts/${encodeURIComponent(accountId)}/avatar`, {
      method: 'PUT',
      body: form,
    }).then(normalizeAccountUrls)
  },
  removeAvatar(accountId: string): Promise<Account> {
    return request<Account>(`/api/accounts/${encodeURIComponent(accountId)}/avatar`, { method: 'DELETE' })
      .then(normalizeAccountUrls)
  },
}
