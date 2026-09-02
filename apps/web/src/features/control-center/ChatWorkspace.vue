<script setup lang="ts">
import { nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { Check, CheckCheck, Download, Inbox, Send, WifiOff } from 'lucide-vue-next'
import type { Account, Conversation, Message } from '@/types'
import MediaComposer from './MediaComposer.vue'
import StatusPill from './StatusPill.vue'

const props = defineProps<{
  account: Account | null
  conversation: Conversation | null
  messages: readonly Message[]
  busy: boolean
  mediaBusy: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
  sendMedia: [file: File, caption: string]
  error: [message: string]
}>()

const draft = shallowRef('')
const messagePane = useTemplateRef<HTMLDivElement>('messagePane')

watch(
  () => [props.messages.length, props.conversation?.id],
  async () => {
    await nextTick()
    messagePane.value?.scrollTo({ top: messagePane.value.scrollHeight, behavior: 'smooth' })
  },
  { immediate: true },
)

function send(): void {
  const text = draft.value.trim()
  if (!text || props.busy || props.account?.status !== 'ONLINE') return
  emit('send', text)
  draft.value = ''
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  )
}

function hasCaption(message: Message): boolean {
  return Boolean(message.body && message.body !== '[图片]' && message.body !== '[视频]')
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function handleMediaSend(file: File, caption: string): void {
  emit('sendMedia', file, caption)
}
</script>

<template>
  <section class="chat-workspace">
    <template v-if="props.account && props.conversation">
      <header class="chat-header">
        <div class="contact-mark" :class="`tone-${props.conversation.avatarTone}`">
          {{ props.conversation.title.slice(0, 1).toUpperCase() }}
        </div>
        <div class="contact-copy">
          <strong>{{ props.conversation.title }}</strong>
          <span>{{ props.conversation.subtitle }}</span>
        </div>
        <div class="chat-status">
          <StatusPill :status="props.account.status" compact />
          <span class="provider-mark">EVOLUTION LIVE</span>
        </div>
      </header>

      <div ref="messagePane" class="message-pane">
        <div class="date-divider"><span>今天</span></div>
        <article
          v-for="message in props.messages"
          :key="message.id"
          class="message-row"
          :class="message.direction === 'OUT' ? 'outgoing' : 'incoming'"
        >
          <div class="message-bubble">
            <div v-if="message.media" class="message-media">
              <img
                v-if="message.media.kind === 'IMAGE'"
                :src="message.media.url"
                :alt="hasCaption(message) ? message.body : 'WhatsApp 图片'"
                loading="lazy"
              />
              <video v-else :src="message.media.url" controls playsinline preload="metadata" />
              <a class="media-file" :href="message.media.url" target="_blank" rel="noopener">
                <span>{{ message.media.fileName }}</span>
                <small>{{ formatSize(message.media.size) }}</small>
                <Download :size="12" />
              </a>
            </div>
            <p v-if="!message.media || hasCaption(message)">{{ message.body }}</p>
            <span class="message-meta">
              {{ formatTime(message.createdAt) }}
              <CheckCheck v-if="message.status === 'READ' || message.status === 'DELIVERED'" :size="12" />
              <Check v-else-if="message.direction === 'OUT'" :size="12" />
              <span v-if="message.status === 'FAILED'" class="failed">发送失败</span>
            </span>
          </div>
        </article>

        <div v-if="props.messages.length === 0" class="empty-messages">
          <Inbox :size="27" />
          <strong>这是一段新会话</strong>
          <span>发送第一条消息开始记录</span>
        </div>
      </div>

      <footer class="composer">
        <div v-if="props.account.status !== 'ONLINE'" class="offline-notice">
          <WifiOff :size="14" /> 当前账号未上线，完成扫码后才能发送
        </div>
        <div class="composer-inner">
          <MediaComposer
            :disabled="props.account.status !== 'ONLINE'"
            :busy="props.mediaBusy"
            @send="handleMediaSend"
            @error="emit('error', $event)"
          />
          <textarea
            v-model="draft"
            rows="1"
            placeholder="输入消息，Enter 发送 · Shift + Enter 换行"
            :disabled="props.account.status !== 'ONLINE'"
            @keydown="handleKeydown"
          />
          <button class="send-button" :disabled="!draft.trim() || props.busy || props.account.status !== 'ONLINE'" @click="send">
            <Send :size="17" />
          </button>
        </div>
        <div class="composer-footnote">
          <span>仅向已授权联系人发送消息</span>
          <span>{{ draft.length }} / 4096</span>
        </div>
      </footer>
    </template>

    <div v-else class="empty-workspace">
      <div class="empty-orbit"><Inbox :size="32" /></div>
      <p class="empty-kicker">CONTROL CHANNEL</p>
      <h2>选择一个会话</h2>
      <span>消息、回执与账号状态将在此处实时同步</span>
    </div>
  </section>
</template>

<style scoped>
.chat-workspace { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--paper-bright); }
.chat-header { min-height: 72px; padding: 13px 20px; display: flex; align-items: center; gap: 11px; border-bottom: 1px solid var(--line); }
.contact-mark { width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center; color: var(--ink); font-family: "Songti SC", serif; font-size: 17px; font-weight: 700; }
.tone-amber { background: var(--amber); }.tone-mint { background: var(--mint); }.tone-blue { background: var(--blue); }.tone-rose { background: var(--rose); }
.contact-copy { min-width: 0; flex: 1; display: grid; gap: 3px; }
.contact-copy strong { font-size: 13px; }
.contact-copy span { color: var(--muted); font-size: 9px; }
.chat-status { display: flex; align-items: center; gap: 9px; }
.provider-mark { color: #808780; font-size: 8px; font-weight: 700; letter-spacing: .13em; }
.message-pane { flex: 1; min-height: 0; overflow-y: auto; padding: 23px clamp(20px, 4vw, 55px); background-image: linear-gradient(rgba(28, 39, 31, .028) 1px, transparent 1px), linear-gradient(90deg, rgba(28, 39, 31, .028) 1px, transparent 1px); background-size: 32px 32px; }
.date-divider { display: flex; align-items: center; gap: 12px; margin: 0 0 20px; color: #8c938d; font-size: 8px; letter-spacing: .12em; }
.date-divider::before, .date-divider::after { content: ''; height: 1px; flex: 1; background: var(--line); }
.message-row { display: flex; margin: 7px 0; animation: message-in .22s ease-out both; }
.message-row.outgoing { justify-content: flex-end; }
.message-bubble { max-width: min(70%, 560px); padding: 11px 13px 8px; background: #e3e0d7; box-shadow: 0 5px 13px rgba(26, 35, 28, .045); }
.outgoing .message-bubble { background: #d8efad; }
.message-media { width: min(420px, 50vw); margin: -5px -7px 8px; overflow: hidden; background: #111713; }
.message-media img, .message-media video { width: 100%; max-height: 390px; display: block; object-fit: contain; background: #0c110d; }
.media-file { min-height: 31px; padding: 6px 8px; display: flex; align-items: center; gap: 7px; color: #c4d0c6; text-decoration: none; background: #182019; }
.media-file span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 8px; }.media-file small { color: #77847a; font-size: 7px; }.media-file svg { color: var(--acid); }
.message-bubble p { margin: 0; color: #1c251f; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.55; }
.message-meta { margin-top: 5px; display: flex; align-items: center; justify-content: flex-end; gap: 4px; color: #7a827c; font-size: 8px; }
.outgoing .message-meta svg { color: #4d7e1f; }
.failed { color: var(--danger); }
.empty-messages { min-height: 65%; display: grid; place-content: center; justify-items: center; gap: 7px; color: #899087; }
.empty-messages strong { color: #59615a; font-size: 12px; }.empty-messages span { font-size: 9px; }
.composer { border-top: 1px solid var(--line); background: #eeebe3; }
.offline-notice { min-height: 31px; padding: 7px 18px; display: flex; align-items: center; gap: 7px; color: #9a641a; background: #f4dfba; font-size: 9px; }
.composer-inner { padding: 12px 15px 7px; display: flex; align-items: flex-end; gap: 8px; }
.composer-inner textarea { flex: 1; min-height: 38px; max-height: 110px; resize: vertical; border: 1px solid #c7c5bd; background: var(--paper-bright); padding: 10px 12px; color: var(--ink); font-size: 11px; line-height: 1.5; }
.composer-inner textarea:disabled { opacity: .6; }
.send-button { width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center; border: 1px solid #bebfb8; background: transparent; color: #6d766f; }
.send-button { border-color: var(--ink); background: var(--ink); color: var(--acid); }
.send-button:hover:not(:disabled) { background: var(--acid); color: var(--ink); border-color: var(--acid-deep); }
.send-button:disabled { opacity: .36; cursor: not-allowed; }
.composer-footnote { padding: 0 16px 9px 61px; display: flex; justify-content: space-between; color: #929791; font-size: 8px; }
.empty-workspace { flex: 1; display: grid; place-content: center; justify-items: center; text-align: center; color: #7d857e; }
.empty-orbit { width: 78px; height: 78px; display: grid; place-items: center; border: 1px solid #aeb4ad; transform: rotate(45deg); margin-bottom: 30px; }
.empty-orbit svg { transform: rotate(-45deg); color: #4d5a50; }
.empty-kicker { margin: 0 0 7px; color: #8b938c; font-size: 8px; letter-spacing: .2em; }
.empty-workspace h2 { margin: 0 0 7px; color: #313b33; font-family: "Songti SC", serif; font-size: 25px; }.empty-workspace span { font-size: 9px; }
@keyframes message-in { from { opacity: 0; transform: translateY(5px); } }
</style>
