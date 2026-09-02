import type { Account, Conversation, Message } from '@/types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = init?.body !== undefined && !(init.body instanceof FormData)
  const response = await fetch(path, {
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
    return result.items
  },
  createAccount(name: string): Promise<Account> {
    return request('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },
  connectAccount(accountId: string): Promise<Account> {
    return request(`/api/accounts/${encodeURIComponent(accountId)}/connect`, { method: 'POST' })
  },
  disconnectAccount(accountId: string): Promise<Account> {
    return request(`/api/accounts/${encodeURIComponent(accountId)}/disconnect`, { method: 'POST' })
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
    return result.items
  },
  sendMessage(accountId: string, conversationId: string, text: string): Promise<Message> {
    return request(
      `/api/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ text, clientRef: crypto.randomUUID() }),
      },
    )
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
    return request(
      `/api/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/media`,
      { method: 'POST', body: form },
    )
  },
  updateAvatar(accountId: string, file: File): Promise<Account> {
    const form = new FormData()
    form.append('file', file, file.name)
    return request(`/api/accounts/${encodeURIComponent(accountId)}/avatar`, {
      method: 'PUT',
      body: form,
    })
  },
  removeAvatar(accountId: string): Promise<Account> {
    return request(`/api/accounts/${encodeURIComponent(accountId)}/avatar`, { method: 'DELETE' })
  },
}
