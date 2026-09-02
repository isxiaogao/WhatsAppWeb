import { computed, onMounted, onUnmounted, readonly, shallowRef, watch } from 'vue'
import { controlCenterApi } from '@/api/control-center'
import { controlApiUrl, normalizeControlEventUrls } from '@/api/runtime-config'
import type { Account, ControlEvent, Conversation, Message } from '@/types'

export function useControlCenter() {
  const accounts = shallowRef<Account[]>([])
  const conversations = shallowRef<Conversation[]>([])
  const messages = shallowRef<Message[]>([])
  const selectedAccountId = shallowRef<string | null>(null)
  const selectedConversationId = shallowRef<string | null>(null)
  const loading = shallowRef(true)
  const busy = shallowRef(false)
  const mediaBusy = shallowRef(false)
  const profileBusy = shallowRef(false)
  const error = shallowRef<string | null>(null)
  let eventSource: EventSource | null = null

  const selectedAccount = computed(
    () => accounts.value.find((account) => account.id === selectedAccountId.value) ?? null,
  )
  const selectedConversation = computed(
    () =>
      conversations.value.find(
        (conversation) => conversation.id === selectedConversationId.value,
      ) ?? null,
  )
  const onlineCount = computed(
    () => accounts.value.filter((account) => account.status === 'ONLINE').length,
  )
  const unreadCount = computed(() =>
    conversations.value.reduce((total, conversation) => total + conversation.unreadCount, 0),
  )

  watch(selectedAccountId, async (accountId, _previous, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    selectedConversationId.value = null
    messages.value = []
    if (!accountId) {
      conversations.value = []
      return
    }
    try {
      conversations.value = await controlCenterApi.listConversations(accountId)
      if (controller.signal.aborted) return
      selectedConversationId.value = conversations.value[0]?.id ?? null
    } catch (reason) {
      if (!controller.signal.aborted) reportError(reason)
    }
  })

  watch(selectedConversationId, async (conversationId, _previous, onCleanup) => {
    const accountId = selectedAccountId.value
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    messages.value = []
    if (!accountId || !conversationId) return
    try {
      const result = await controlCenterApi.listMessages(accountId, conversationId)
      if (!controller.signal.aborted) messages.value = result
    } catch (reason) {
      if (!controller.signal.aborted) reportError(reason)
    }
  })

  onMounted(async () => {
    try {
      accounts.value = await controlCenterApi.listAccounts()
      selectedAccountId.value = accounts.value[0]?.id ?? null
      openEventStream()
    } catch (reason) {
      reportError(reason)
    } finally {
      loading.value = false
    }
  })

  onUnmounted(() => eventSource?.close())

  function selectAccount(accountId: string): void {
    selectedAccountId.value = accountId
  }

  function selectConversation(conversationId: string): void {
    selectedConversationId.value = conversationId
  }

  async function createAndConnectAccount(input: { name: string }): Promise<Account> {
    return withBusy(async () => {
      const created = await controlCenterApi.createAccount(input.name)
      upsertAccount(created)
      selectedAccountId.value = created.id
      const connecting = await controlCenterApi.connectAccount(created.id)
      upsertAccount(connecting)
      return connecting
    })
  }

  async function connectAccount(accountId: string): Promise<Account> {
    return withBusy(async () => {
      selectedAccountId.value = accountId
      const account = await controlCenterApi.connectAccount(accountId)
      upsertAccount(account)
      return account
    })
  }

  async function disconnectAccount(accountId: string): Promise<void> {
    await withBusy(async () => upsertAccount(await controlCenterApi.disconnectAccount(accountId)))
  }

  async function deleteAccount(accountId: string): Promise<void> {
    await withBusy(async () => {
      await controlCenterApi.deleteAccount(accountId)
      removeAccount(accountId)
    })
  }

  async function createConversation(input: { target: string; name?: string }): Promise<void> {
    const accountId = selectedAccountId.value
    if (!accountId) return
    await withBusy(async () => {
      const created = await controlCenterApi.createConversation(accountId, input.target, input.name)
      upsertConversation(created)
      selectedConversationId.value = created.id
    })
  }

  async function sendMessage(text: string): Promise<void> {
    const accountId = selectedAccountId.value
    const conversationId = selectedConversationId.value
    if (!accountId || !conversationId) return
    await withBusy(async () => {
      const sent = await controlCenterApi.sendMessage(accountId, conversationId, text)
      upsertMessage(sent)
    })
  }

  async function sendMedia(file: File, caption: string): Promise<void> {
    const accountId = selectedAccountId.value
    const conversationId = selectedConversationId.value
    if (!accountId || !conversationId || mediaBusy.value) return
    mediaBusy.value = true
    error.value = null
    try {
      const sent = await controlCenterApi.sendMedia(accountId, conversationId, file, caption)
      upsertMessage(sent)
    } catch (reason) {
      reportError(reason)
      throw reason
    } finally {
      mediaBusy.value = false
    }
  }

  async function updateAvatar(accountId: string, file: File): Promise<void> {
    if (profileBusy.value) return
    profileBusy.value = true
    error.value = null
    try {
      upsertAccount(await controlCenterApi.updateAvatar(accountId, file))
    } catch (reason) {
      reportError(reason)
      throw reason
    } finally {
      profileBusy.value = false
    }
  }

  async function removeAvatar(accountId: string): Promise<void> {
    if (profileBusy.value) return
    profileBusy.value = true
    error.value = null
    try {
      upsertAccount(await controlCenterApi.removeAvatar(accountId))
    } catch (reason) {
      reportError(reason)
      throw reason
    } finally {
      profileBusy.value = false
    }
  }

  function clearError(): void {
    error.value = null
  }

  function showError(message: string): void {
    error.value = message
  }

  function openEventStream(): void {
    eventSource = new EventSource(controlApiUrl('/api/events'))
    eventSource.addEventListener('control', (event) => {
      const payload = normalizeControlEventUrls(
        JSON.parse((event as MessageEvent<string>).data) as ControlEvent,
      )
      if (payload.type === 'account.updated') upsertAccount(payload.data)
      if (payload.type === 'account.deleted') removeAccount(payload.data.id)
      if (payload.type === 'conversation.updated') upsertConversation(payload.data)
      if (payload.type === 'message.created' || payload.type === 'message.updated') {
        upsertMessage(payload.data)
      }
    })
  }

  function upsertAccount(account: Account): void {
    accounts.value = upsertById(accounts.value, account)
  }

  function removeAccount(accountId: string): void {
    const wasSelected = selectedAccountId.value === accountId
    accounts.value = accounts.value.filter((account) => account.id !== accountId)
    if (wasSelected) selectedAccountId.value = accounts.value[0]?.id ?? null
  }

  function upsertConversation(conversation: Conversation): void {
    if (conversation.accountId !== selectedAccountId.value) return
    conversations.value = upsertById(conversations.value, conversation).sort((a, b) =>
      b.lastMessageAt.localeCompare(a.lastMessageAt),
    )
  }

  function upsertMessage(message: Message): void {
    if (
      message.accountId !== selectedAccountId.value ||
      message.conversationId !== selectedConversationId.value
    ) return
    messages.value = upsertById(messages.value, message).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )
  }

  async function withBusy<T>(action: () => Promise<T>): Promise<T> {
    busy.value = true
    error.value = null
    try {
      return await action()
    } catch (reason) {
      reportError(reason)
      throw reason
    } finally {
      busy.value = false
    }
  }

  function reportError(reason: unknown): void {
    error.value = reason instanceof Error ? reason.message : '发生未知错误'
  }

  return {
    accounts: readonly(accounts),
    conversations: readonly(conversations),
    messages: readonly(messages),
    selectedAccountId: readonly(selectedAccountId),
    selectedConversationId: readonly(selectedConversationId),
    selectedAccount,
    selectedConversation,
    onlineCount,
    unreadCount,
    loading: readonly(loading),
    busy: readonly(busy),
    mediaBusy: readonly(mediaBusy),
    profileBusy: readonly(profileBusy),
    error: readonly(error),
    selectAccount,
    selectConversation,
    createAndConnectAccount,
    connectAccount,
    disconnectAccount,
    deleteAccount,
    createConversation,
    sendMessage,
    sendMedia,
    updateAvatar,
    removeAvatar,
    clearError,
    showError,
  }
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index === -1) return [...items, next]
  return items.map((item, itemIndex) => (itemIndex === index ? next : item))
}
