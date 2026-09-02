<script setup lang="ts">
import { Copy, Pencil, Play, Square, Trash2 } from 'lucide-vue-next'
import type { BrowserProfile, BrowserRuntimeStatus } from '@/desktop'

const props = defineProps<{
  profiles: readonly BrowserProfile[]
  busyProfileId: string | null
}>()
const emit = defineEmits<{
  start: [profileId: string]
  stop: [profileId: string]
  edit: [profile: BrowserProfile]
  delete: [profile: BrowserProfile]
}>()

const statusLabels: Record<BrowserRuntimeStatus, string> = {
  STOPPED: '已停止',
  STARTING: '启动中',
  RUNNING: '运行中',
  STOPPING: '关闭中',
  CRASHED: '异常退出',
}

function formatTime(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '尚未启动'
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return value
  }
}

function canStart(profile: BrowserProfile): boolean {
  return profile.runtime.status === 'STOPPED' || profile.runtime.status === 'CRASHED'
}

function canStop(profile: BrowserProfile): boolean {
  return profile.runtime.status === 'RUNNING'
}

function isChanging(profile: BrowserProfile): boolean {
  return profile.runtime.status === 'STARTING' || profile.runtime.status === 'STOPPING'
}

async function copyEndpoint(endpoint: string): Promise<void> {
  await navigator.clipboard.writeText(endpoint)
}
</script>

<template>
  <div class="profile-list">
    <article v-for="profile in props.profiles" :key="profile.id" class="profile-card">
      <div class="profile-card-header">
        <div>
          <p>{{ profile.browser === 'chrome' ? 'GOOGLE CHROME' : 'MICROSOFT EDGE' }}</p>
          <h3>{{ profile.name }}</h3>
        </div>
        <span class="status-pill" :class="`is-${profile.runtime.status.toLowerCase()}`">
          {{ statusLabels[profile.runtime.status] }}
        </span>
      </div>

      <dl class="profile-details">
        <div><dt>责任人</dt><dd>{{ profile.owner }}</dd></div>
        <div><dt>用途</dt><dd>{{ profile.purpose }}</dd></div>
        <div><dt>时区 / 语言</dt><dd>{{ profile.timezone }} · {{ profile.locale }}</dd></div>
        <div><dt>代理</dt><dd>{{ profile.proxyUrl || '直连' }}{{ profile.proxyUsername ? '（已认证）' : '' }}</dd></div>
        <div><dt>打开网站</dt><dd :title="profile.startUrl">{{ displayUrl(profile.startUrl) }}</dd></div>
        <div><dt>最近启动</dt><dd>{{ formatTime(profile.lastOpenedAt) }}</dd></div>
        <div><dt>指纹模式</dt><dd>{{ profile.fingerprintMode === 'enhanced' ? '固定增强指纹' : '本机原生指纹' }}</dd></div>
        <div><dt>屏幕 / CPU</dt><dd>{{ profile.fingerprint.screen }} · {{ profile.fingerprint.hardwareConcurrency }} 核</dd></div>
        <div><dt>平台</dt><dd>{{ profile.fingerprint.platform }} · {{ profile.fingerprint.language }}</dd></div>
      </dl>

      <details class="fingerprint-details">
        <summary>查看固定指纹摘要</summary>
        <dl>
          <div><dt>User-Agent</dt><dd>{{ profile.fingerprint.userAgent }}</dd></div>
          <div><dt>WebGL</dt><dd>{{ profile.fingerprint.webgl }}</dd></div>
        </dl>
      </details>

      <div v-if="profile.runtime.cdpEndpoint" class="cdp-row">
        <span>CDP</span>
        <code>{{ profile.runtime.cdpEndpoint }}</code>
        <button type="button" title="复制 CDP 地址" @click="copyEndpoint(profile.runtime.cdpEndpoint)">
          <Copy :size="13" />
        </button>
      </div>
      <p v-if="profile.runtime.lastError" class="runtime-error">{{ profile.runtime.lastError }}</p>

      <div class="profile-actions">
        <button
          v-if="canStart(profile)"
          class="primary-action"
          :disabled="props.busyProfileId !== null || isChanging(profile)"
          type="button"
          @click="emit('start', profile.id)"
        >
          <Play :size="13" />
          {{ props.busyProfileId === profile.id ? '正在启动…' : '启动浏览器' }}
        </button>
        <button
          v-else
          class="stop-action"
          :disabled="props.busyProfileId !== null || !canStop(profile)"
          type="button"
          @click="emit('stop', profile.id)"
        >
          <Square :size="12" />
          {{ props.busyProfileId === profile.id ? '正在关闭…' : '关闭浏览器' }}
        </button>
        <button
          class="secondary-action"
          :disabled="props.busyProfileId !== null || !canStart(profile)"
          type="button"
          @click="emit('edit', profile)"
        >
          <Pencil :size="13" />编辑
        </button>
        <button
          class="danger-action"
          :disabled="props.busyProfileId !== null || isChanging(profile)"
          type="button"
          @click="emit('delete', profile)"
        >
          <Trash2 :size="13" />删除
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.profile-list { display: grid; gap: 12px; }
.profile-card { padding: 17px; border: 1px solid #354137; background: #151d17; }
.profile-card-header { display: flex; justify-content: space-between; gap: 10px; }
.profile-card-header p { margin: 0 0 5px; color: #8ea48a; font-size: 8px; font-weight: 800; letter-spacing: .13em; }
.profile-card-header h3 { margin: 0; color: #eef3ee; font-size: 15px; }
.status-pill { align-self: start; padding: 4px 7px; border: 1px solid #4a594b; font-size: 8px; letter-spacing: .08em; }
.is-running { color: var(--acid); border-color: #769650; }.is-starting, .is-stopping { color: #f0cf79; border-color: #82703f; }.is-crashed { color: #f09b9f; border-color: #82494d; }.is-stopped { color: #a8b2a9; }
.profile-details { margin: 16px 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 9px; }
.profile-details dt, .fingerprint-details dt { margin-bottom: 4px; color: #778478; font-size: 8px; }
.profile-details dd { margin: 0; overflow: hidden; color: #d0d9d1; font-size: 10px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.fingerprint-details { margin: 0 0 13px; color: #96a397; font-size: 9px; }.fingerprint-details summary { cursor: pointer; }.fingerprint-details dl { margin: 9px 0 0; display: grid; gap: 8px; }.fingerprint-details dd { margin: 0; overflow-wrap: anywhere; color: #bfc9c0; font-size: 9px; line-height: 1.45; }
.cdp-row { margin-bottom: 12px; min-width: 0; padding: 8px 9px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; border-left: 2px solid #66865d; background: #0e1510; }.cdp-row span { color: var(--acid); font-size: 8px; font-weight: 800; }.cdp-row code { overflow: hidden; color: #b8c4b9; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.cdp-row button { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid #4b594e; color: #bcc8bd; background: transparent; }
.runtime-error { margin: 0 0 12px; color: #ef9ba0; font-size: 9px; line-height: 1.5; }
.profile-actions { display: flex; flex-wrap: wrap; gap: 7px; }.profile-actions button { min-height: 34px; padding: 0 11px; display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 700; }.primary-action { border: 1px solid var(--acid); color: #111710; background: var(--acid); }.stop-action, .secondary-action { border: 1px solid #59685c; color: #dce6dd; background: transparent; }.danger-action { margin-left: auto; border: 1px solid #71464a; color: #e4b4b7; background: transparent; }.profile-actions button:disabled { cursor: not-allowed; opacity: .45; }
@media (max-width: 680px) { .profile-details { grid-template-columns: 1fr 1fr; }.danger-action { margin-left: 0; } }
</style>
