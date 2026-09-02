<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import {
  Activity,
  Bell,
  Boxes,
  Cloud,
  Command,
  MessageSquareText,
  ServerCog,
  Settings2,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-vue-next'
import type { Account } from '@/types'
import AccountDeleteDialog from './AccountDeleteDialog.vue'
import AccountRail from './AccountRail.vue'
import AccountProfileDialog from './AccountProfileDialog.vue'
import ChatWorkspace from './ChatWorkspace.vue'
import ConnectAccountDialog from './ConnectAccountDialog.vue'
import ConversationList from './ConversationList.vue'
import DesktopConnectionDialog from './DesktopConnectionDialog.vue'
import { useControlCenter } from './useControlCenter'
import { currentControlApiUrl, isDesktopRuntime, saveControlApiUrl } from '@/api/runtime-config'

const {
  accounts,
  conversations,
  messages,
  selectedAccountId,
  selectedConversationId,
  selectedAccount,
  selectedConversation,
  onlineCount,
  unreadCount,
  loading,
  busy,
  mediaBusy,
  profileBusy,
  error,
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
} = useControlCenter()

const dialogOpen = shallowRef(false)
const dialogAccountId = shallowRef<string | null>(null)
const dialogAccount = computed(
  () => accounts.value.find((account) => account.id === dialogAccountId.value) ?? null,
)
const profileDialogOpen = shallowRef(false)
const profileAccountId = shallowRef<string | null>(null)
const profileAccount = computed(
  () => accounts.value.find((account) => account.id === profileAccountId.value) ?? null,
)
const deleteDialogOpen = shallowRef(false)
const deleteAccountId = shallowRef<string | null>(null)
const deleteDialogAccount = computed(
  () => accounts.value.find((account) => account.id === deleteAccountId.value) ?? null,
)
const desktopSettingsOpen = shallowRef(false)
const desktopSettingsBusy = shallowRef(false)
const desktopControlApiUrl = currentControlApiUrl()

const operatorTime = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(new Date())

function openAddDialog(): void {
  dialogAccountId.value = null
  dialogOpen.value = true
}

function openConnectDialog(account: Account): void {
  dialogAccountId.value = account.id
  dialogOpen.value = true
  void connectAccount(account.id).catch(() => undefined)
}

async function handleCreate(input: { name: string }): Promise<void> {
  try {
    const account = await createAndConnectAccount(input)
    dialogAccountId.value = account.id
  } catch {
    // The composable exposes the user-facing error.
  }
}

function handleDisconnect(account: Account): void {
  void disconnectAccount(account.id).catch(() => undefined)
}

function handleCreateConversation(input: { target: string; name?: string }): void {
  void createConversation(input).catch(() => undefined)
}

function handleSend(text: string): void {
  void sendMessage(text).catch(() => undefined)
}

function handleSendMedia(file: File, caption: string): void {
  void sendMedia(file, caption).catch(() => undefined)
}

function openProfileDialog(account: Account): void {
  profileAccountId.value = account.id
  profileDialogOpen.value = true
}

function openDeleteDialog(account: Account): void {
  deleteAccountId.value = account.id
  deleteDialogOpen.value = true
}

async function handleDeleteAccount(accountId: string): Promise<void> {
  try {
    await deleteAccount(accountId)
    deleteDialogOpen.value = false
    deleteAccountId.value = null
  } catch {
    // The composable exposes the user-facing error.
  }
}

async function handleSaveAvatar(accountId: string, file: File): Promise<void> {
  try {
    await updateAvatar(accountId, file)
    profileDialogOpen.value = false
  } catch {
    // The composable exposes the user-facing error.
  }
}

async function handleRemoveAvatar(accountId: string): Promise<void> {
  try {
    await removeAvatar(accountId)
    profileDialogOpen.value = false
  } catch {
    // The composable exposes the user-facing error.
  }
}

function openDesktopSettings(): void {
  desktopSettingsOpen.value = true
}

async function saveDesktopSettings(apiUrl: string): Promise<void> {
  desktopSettingsBusy.value = true
  try {
    await saveControlApiUrl(apiUrl)
    window.location.reload()
  } catch (reason) {
    showError(reason instanceof Error ? reason.message : '无法保存桌面端设置')
  } finally {
    desktopSettingsBusy.value = false
  }
}
</script>

<template>
  <div class="app-frame">
    <aside class="nav-rail">
      <div class="brand-block">
        <span class="brand-signal"><i /><i /><i /></span>
        <strong>WA</strong>
        <small>CTRL</small>
      </div>
      <nav class="primary-nav" aria-label="主导航">
        <button class="nav-button active" title="控制台"><Boxes :size="19" /></button>
        <button class="nav-button" title="消息"><MessageSquareText :size="19" /></button>
        <button class="nav-button" title="联系人"><UsersRound :size="19" /></button>
        <button class="nav-button" title="节点监控"><Activity :size="19" /></button>
        <button class="nav-button" title="安全策略"><ShieldCheck :size="19" /></button>
      </nav>
      <div class="nav-footer">
        <button
          v-if="isDesktopRuntime"
          class="nav-button"
          title="桌面端连接设置"
          @click="openDesktopSettings"
        ><Settings2 :size="18" /></button>
        <span class="operator-avatar">OP</span>
      </div>
    </aside>

    <div class="control-shell">
      <header class="top-bar">
        <div class="title-lockup">
          <p>CLOUD SESSION OPERATIONS</p>
          <h1>WhatsApp 云中控</h1>
        </div>
        <div class="top-actions">
          <span class="system-state"><i /> CONTROL PLANE HEALTHY</span>
          <span class="clock">CST {{ operatorTime }}</span>
          <button aria-label="通知"><Bell :size="17" /><span class="notification-dot" /></button>
          <button aria-label="命令面板"><Command :size="17" /></button>
        </div>
      </header>

      <section class="status-strip">
        <div class="metric primary">
          <Cloud :size="17" />
          <span><strong>{{ onlineCount }}</strong> 在线节点</span>
        </div>
        <div class="metric">
          <ServerCog :size="17" />
          <span><strong>{{ accounts.length }}</strong> Evolution 实例</span>
        </div>
        <div class="metric">
          <MessageSquareText :size="17" />
          <span><strong>{{ unreadCount }}</strong> 未读消息</span>
        </div>
        <p class="architecture-note">CONTROL API → EVOLUTION API → BAILEYS</p>
      </section>

      <main class="workspace-grid">
        <AccountRail
          :accounts="accounts"
          :selected-id="selectedAccountId"
          :busy="busy || profileBusy"
          @select="selectAccount"
          @add="openAddDialog"
          @connect="openConnectDialog"
          @disconnect="handleDisconnect"
          @delete="openDeleteDialog"
          @edit-profile="openProfileDialog"
        />
        <ConversationList
          :conversations="conversations"
          :selected-id="selectedConversationId"
          @select="selectConversation"
          @create="handleCreateConversation"
        />
        <ChatWorkspace
          :account="selectedAccount"
          :conversation="selectedConversation"
          :messages="messages"
          :busy="busy"
          :media-busy="mediaBusy"
          @send="handleSend"
          @send-media="handleSendMedia"
          @error="showError"
        />
      </main>
    </div>

    <ConnectAccountDialog
      :open="dialogOpen"
      :account="dialogAccount"
      :busy="busy"
      @close="dialogOpen = false"
      @create="handleCreate"
    />

    <AccountProfileDialog
      :open="profileDialogOpen"
      :account="profileAccount"
      :busy="profileBusy"
      @close="profileDialogOpen = false"
      @save="handleSaveAvatar"
      @remove="handleRemoveAvatar"
      @error="showError"
    />

    <AccountDeleteDialog
      :open="deleteDialogOpen"
      :account="deleteDialogAccount"
      :busy="busy"
      @close="deleteDialogOpen = false"
      @confirm="handleDeleteAccount"
    />

    <DesktopConnectionDialog
      :open="desktopSettingsOpen"
      :api-url="desktopControlApiUrl"
      :busy="desktopSettingsBusy"
      @close="desktopSettingsOpen = false"
      @save="saveDesktopSettings"
    />

    <div v-if="loading" class="loading-screen">
      <span class="loading-mark"><i /><i /><i /></span>
      <p>正在建立控制平面</p>
    </div>

    <aside v-if="error" class="error-toast" role="alert">
      <span><strong>操作未完成</strong>{{ error }}</span>
      <button aria-label="关闭错误提示" @click="clearError"><X :size="16" /></button>
    </aside>
  </div>
</template>

<style scoped>
.app-frame { min-height: 100vh; display: grid; grid-template-columns: 72px minmax(0, 1fr); background: #0b100d; }
.nav-rail { height: 100vh; padding: 15px 11px; display: flex; flex-direction: column; align-items: center; color: #dfe7df; background: #0b100d; border-right: 1px solid #29332b; }
.brand-block { width: 46px; height: 63px; display: grid; place-content: center; justify-items: center; border: 1px solid #465048; position: relative; }
.brand-block strong { font-size: 16px; line-height: 1; letter-spacing: .03em; }.brand-block small { margin-top: 3px; color: var(--acid); font-size: 7px; font-weight: 800; letter-spacing: .18em; }
.brand-signal { position: absolute; top: -4px; right: 5px; display: flex; gap: 2px; }.brand-signal i { width: 3px; background: var(--acid); }.brand-signal i:nth-child(1) { height: 4px; }.brand-signal i:nth-child(2) { height: 7px; }.brand-signal i:nth-child(3) { height: 10px; }
.primary-nav { display: grid; gap: 8px; margin-top: 42px; }.nav-footer { margin-top: auto; display: grid; justify-items: center; gap: 15px; }
.nav-button { width: 42px; height: 42px; border: 1px solid transparent; background: transparent; color: #78847b; display: grid; place-items: center; position: relative; }
.nav-button:hover { color: #dce5dd; border-color: #38423a; }.nav-button.active { color: var(--ink); background: var(--acid); }.nav-button.active::after { content: ''; position: absolute; right: -13px; width: 2px; height: 22px; background: var(--acid); }
.operator-avatar { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid #536057; color: #d3ddd5; font-size: 9px; font-weight: 800; }
.control-shell { height: 100vh; min-width: 0; display: grid; grid-template-rows: 68px 42px minmax(0, 1fr); }
.top-bar { padding: 0 20px; display: flex; align-items: center; justify-content: space-between; color: #e9eee9; background: #111713; border-bottom: 1px solid #303932; }
.title-lockup p { margin: 0 0 2px; color: #7f8c82; font-size: 7px; font-weight: 700; letter-spacing: .22em; }.title-lockup h1 { margin: 0; font-family: "Songti SC", serif; font-size: 20px; font-weight: 600; }
.top-actions { display: flex; align-items: center; gap: 13px; }.top-actions button { width: 33px; height: 33px; border: 1px solid #3b463d; background: transparent; color: #aeb9b0; display: grid; place-items: center; position: relative; }.top-actions button:hover { color: var(--acid); border-color: #657267; }
.system-state { display: flex; align-items: center; gap: 7px; color: #8e9b91; font-size: 7px; font-weight: 700; letter-spacing: .12em; }.system-state i { width: 6px; height: 6px; border-radius: 50%; background: var(--acid); box-shadow: 0 0 0 4px rgba(185, 243, 76, .1); }.clock { color: #7e8980; font-family: "Cascadia Code", monospace; font-size: 8px; }.notification-dot { position: absolute; top: 6px; right: 6px; width: 5px; height: 5px; border-radius: 50%; background: var(--amber); }
.status-strip { min-width: 0; display: flex; align-items: center; color: #b2bcb4; background: #182019; border-bottom: 1px solid #303932; overflow: hidden; }
.metric { height: 100%; padding: 0 17px; display: flex; align-items: center; gap: 8px; border-right: 1px solid #354037; font-size: 8px; letter-spacing: .05em; }.metric strong { margin-right: 3px; color: #f0f3ef; font-size: 12px; }.metric.primary svg { color: var(--acid); }.architecture-note { margin-left: auto; padding: 0 17px; color: #647067; font-family: "Cascadia Code", monospace; font-size: 7px; letter-spacing: .1em; white-space: nowrap; }
.workspace-grid { min-width: 0; min-height: 0; display: grid; grid-template-columns: 272px 320px minmax(390px, 1fr); overflow: hidden; }
.loading-screen { position: fixed; inset: 0; z-index: 80; display: grid; place-content: center; justify-items: center; gap: 18px; color: #dfe7df; background: #0b100d; }.loading-screen p { margin: 0; color: #8f9a91; font-size: 9px; letter-spacing: .18em; }.loading-mark { display: flex; align-items: flex-end; gap: 5px; height: 38px; }.loading-mark i { width: 8px; background: var(--acid); animation: load-bars .8s ease-in-out infinite alternate; }.loading-mark i:nth-child(1) { height: 14px; }.loading-mark i:nth-child(2) { height: 26px; animation-delay: .15s; }.loading-mark i:nth-child(3) { height: 38px; animation-delay: .3s; }
.error-toast { position: fixed; z-index: 90; right: 20px; bottom: 20px; width: min(360px, calc(100vw - 40px)); padding: 13px 14px; display: flex; align-items: center; gap: 12px; color: #f5e8e8; background: #762f31; border-left: 4px solid #ef9ba0; box-shadow: 0 15px 40px rgba(0, 0, 0, .25); }.error-toast span { flex: 1; display: grid; gap: 3px; font-size: 10px; }.error-toast strong { font-size: 11px; }.error-toast button { border: 0; background: transparent; color: #f3d8d9; display: grid; place-items: center; }
@keyframes load-bars { to { opacity: .25; transform: scaleY(.55); } }
@media (max-width: 1120px) { .workspace-grid { grid-template-columns: 235px 290px minmax(360px, 1fr); }.architecture-note, .system-state { display: none; } }
@media (max-width: 900px) { .app-frame { grid-template-columns: 54px minmax(800px, 1fr); }.nav-rail { width: 54px; padding-inline: 5px; }.brand-block { width: 40px; }.control-shell { min-width: 800px; }.workspace-grid { grid-template-columns: 230px 280px minmax(360px, 1fr); } }
</style>
