<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { MessageCircle, Plus, Search, Users, X } from 'lucide-vue-next'
import type { Conversation } from '@/types'

const props = defineProps<{
  conversations: readonly Conversation[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [conversationId: string]
  create: [input: { target: string; name?: string }]
}>()

const query = shallowRef('')
const showCreate = shallowRef(false)
const target = shallowRef('')
const name = shallowRef('')

const visibleConversations = computed(() => {
  const value = query.value.trim().toLowerCase()
  if (!value) return props.conversations
  return props.conversations.filter((conversation) =>
    `${conversation.title} ${conversation.subtitle} ${conversation.lastMessagePreview}`
      .toLowerCase()
      .includes(value),
  )
})

function submitConversation(): void {
  if (!target.value.trim()) return
  emit('create', {
    target: target.value,
    ...(name.value.trim() ? { name: name.value } : {}),
  })
  target.value = ''
  name.value = ''
  showCreate.value = false
}

function formatTime(value: string): string {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}
</script>

<template>
  <section class="conversation-panel">
    <div class="conversation-heading">
      <div>
        <p class="eyebrow">INBOX</p>
        <h2 class="panel-title">会话</h2>
      </div>
      <button class="new-chat" aria-label="新建会话" @click="showCreate = !showCreate">
        <X v-if="showCreate" :size="17" />
        <Plus v-else :size="17" />
      </button>
    </div>

    <form v-if="showCreate" class="new-conversation-form" @submit.prevent="submitConversation">
      <span class="form-kicker">NEW DESTINATION</span>
      <input v-model="target" placeholder="国家区号 + 手机号" autocomplete="off" />
      <input v-model="name" placeholder="备注名称（可选）" autocomplete="off" />
      <button type="submit">创建会话</button>
    </form>

    <label class="search-box">
      <Search :size="15" />
      <input v-model="query" type="search" placeholder="搜索会话或消息" />
      <kbd>⌘ K</kbd>
    </label>

    <div class="conversation-list">
      <button
        v-for="conversation in visibleConversations"
        :key="conversation.id"
        class="conversation-item"
        :class="{ selected: conversation.id === props.selectedId }"
        @click="emit('select', conversation.id)"
      >
        <span class="avatar" :class="`tone-${conversation.avatarTone}`">
          <Users v-if="conversation.isGroup" :size="16" />
          <MessageCircle v-else :size="15" />
        </span>
        <span class="conversation-copy">
          <span class="title-line">
            <strong>{{ conversation.title }}</strong>
            <time>{{ formatTime(conversation.lastMessageAt) }}</time>
          </span>
          <span class="subtitle">{{ conversation.subtitle }}</span>
          <span class="preview">{{ conversation.lastMessagePreview }}</span>
        </span>
        <span v-if="conversation.unreadCount" class="unread">{{ conversation.unreadCount }}</span>
      </button>

      <div v-if="visibleConversations.length === 0" class="empty-list">
        <MessageCircle :size="25" />
        <span>没有匹配的会话</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.conversation-panel { min-width: 0; display: flex; flex-direction: column; background: var(--paper); border-right: 1px solid var(--line); overflow: hidden; }
.conversation-heading { min-height: 82px; padding: 20px 20px 15px; display: flex; align-items: center; justify-content: space-between; }
.eyebrow { margin: 0 0 3px; color: #7f877f; font-size: 9px; font-weight: 700; letter-spacing: .19em; }
.panel-title { margin: 0; font-family: "Songti SC", serif; font-size: 25px; font-weight: 600; }
.new-chat { width: 32px; height: 32px; border: 1px solid var(--ink); background: transparent; color: var(--ink); display: grid; place-items: center; }
.new-chat:hover { background: var(--ink); color: var(--paper); }
.new-conversation-form { display: grid; gap: 7px; margin: 0 15px 12px; padding: 13px; background: #dcd8ce; border-left: 3px solid var(--acid-deep); animation: reveal .18s ease-out; }
.form-kicker { color: #767d76; font-size: 8px; font-weight: 700; letter-spacing: .17em; }
.new-conversation-form input { width: 100%; border: 0; border-bottom: 1px solid #a9aaa3; background: transparent; padding: 8px 3px; color: var(--ink); font-size: 11px; }
.new-conversation-form button { border: 0; padding: 8px; background: var(--ink); color: white; font-size: 10px; }
.search-box { display: flex; align-items: center; gap: 9px; margin: 0 15px 13px; padding: 0 11px; min-height: 37px; background: #dedbd2; color: #6d756e; }
.search-box input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font-size: 11px; }
.search-box kbd { padding: 2px 5px; border: 1px solid #b9b8b1; color: #898e89; font-family: inherit; font-size: 8px; }
.conversation-list { min-height: 0; overflow-y: auto; }
.conversation-item { position: relative; width: 100%; min-height: 82px; border: 0; border-top: 1px solid var(--line); background: transparent; color: inherit; display: flex; align-items: flex-start; gap: 11px; padding: 15px; text-align: left; }
.conversation-item:last-of-type { border-bottom: 1px solid var(--line); }
.conversation-item::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: transparent; }
.conversation-item:hover { background: #e9e5dc; }
.conversation-item.selected { background: var(--paper-bright); }
.conversation-item.selected::before { background: var(--acid-deep); }
.avatar { width: 34px; height: 34px; flex: 0 0 auto; display: grid; place-items: center; color: #1b251d; }
.tone-amber { background: var(--amber); }
.tone-mint { background: var(--mint); }
.tone-blue { background: var(--blue); }
.tone-rose { background: var(--rose); }
.conversation-copy { min-width: 0; flex: 1; display: grid; gap: 3px; }
.title-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.title-line strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.title-line time { flex: 0 0 auto; color: #858a85; font-size: 9px; }
.subtitle { color: #7d847e; font-size: 9px; }
.preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #555f57; font-size: 10px; }
.unread { position: absolute; right: 15px; bottom: 13px; min-width: 18px; height: 18px; padding: 0 5px; display: grid; place-items: center; background: var(--acid-deep); color: var(--ink); font-size: 9px; font-weight: 800; }
.empty-list { min-height: 180px; display: grid; place-content: center; justify-items: center; gap: 9px; color: #939991; font-size: 10px; }
@keyframes reveal { from { opacity: 0; transform: translateY(-5px); } }
</style>
