<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { AppWindow, ShieldCheck } from 'lucide-vue-next'
import type { BrowserProfile, BrowserProfileInput } from '@/desktop'
import BrowserProfileForm from './BrowserProfileForm.vue'
import BrowserProfileList from './BrowserProfileList.vue'
import { useBrowserProfiles } from './useBrowserProfiles'

const {
  profiles,
  loading,
  creating,
  busyProfile,
  error,
  create,
  update,
  remove,
  start,
  stop,
  reload,
  clearError,
} = useBrowserProfiles()
const editingProfile = shallowRef<BrowserProfile | null>(null)
const formRevision = shallowRef(0)
const profileCount = computed(() => profiles.value.length)
const runningCount = computed(
  () => profiles.value.filter((profile) => profile.runtime.status === 'RUNNING').length,
)
const formBusy = computed(
  () => creating.value || (editingProfile.value !== null && busyProfile.value?.id === editingProfile.value.id),
)
const busyProfileId = computed(() => busyProfile.value?.id ?? null)

async function submitProfile(input: BrowserProfileInput): Promise<void> {
  try {
    if (editingProfile.value) {
      await update(editingProfile.value.id, input)
      editingProfile.value = null
    } else {
      await create(input)
    }
    formRevision.value += 1
  } catch {
    // The composable exposes the user-facing error.
  }
}

async function startProfile(profileId: string): Promise<void> {
  try {
    await start(profileId)
  } catch {
    // The composable exposes the user-facing error.
  }
}

async function stopProfile(profileId: string): Promise<void> {
  try {
    await stop(profileId)
  } catch {
    // The composable exposes the user-facing error.
  }
}

function editProfile(profile: BrowserProfile): void {
  editingProfile.value = profile
}

async function deleteProfile(profile: BrowserProfile): Promise<void> {
  const confirmed = window.confirm(`确定删除浏览器档案“${profile.name}”吗？Cookie、缓存和登录状态将一并删除。`)
  if (!confirmed) return
  try {
    await remove(profile.id)
    if (editingProfile.value?.id === profile.id) editingProfile.value = null
  } catch {
    // The composable exposes the user-facing error.
  }
}

function cancelEditing(): void {
  editingProfile.value = null
  formRevision.value += 1
}
</script>

<template>
  <main class="browser-workspace">
    <header class="browser-header">
      <div>
        <p>LOCAL CHROMIUM PROFILE RUNTIME</p>
        <h2>浏览器档案</h2>
        <span>每个档案拥有独立数据目录、固定设备指纹和代理配置，由本地 Patchright Chromium Runtime 管理。</span>
      </div>
      <div class="profile-count">
        <AppWindow :size="17" />
        <strong>{{ runningCount }}/{{ profileCount }}</strong>
        <small>运行中 / 全部档案</small>
      </div>
    </header>

    <section class="browser-grid">
      <aside>
        <h3>{{ editingProfile ? `编辑：${editingProfile.name}` : '新建档案' }}</h3>
        <BrowserProfileForm
          :key="`${editingProfile?.id ?? 'new'}-${formRevision}`"
          :busy="formBusy"
          :profile="editingProfile"
          @cancel="cancelEditing"
          @submit="submitProfile"
        />
        <p class="notice">
          <ShieldCheck :size="15" />
          增强指纹会固定到档案并在每次启动复用；代理密码使用 Windows 系统安全存储加密。该方案增强环境差异，但不承诺不可检测。
        </p>
      </aside>

      <section>
        <div class="list-heading">
          <h3>现有档案</h3>
          <span v-if="loading">读取中…</span>
        </div>
        <BrowserProfileList
          v-if="profiles.length"
          :busy-profile-id="busyProfileId"
          :profiles="profiles"
          @delete="deleteProfile"
          @edit="editProfile"
          @start="startProfile"
          @stop="stopProfile"
        />
        <div v-else-if="!loading" class="empty-state">
          <template v-if="error">
            <span>档案读取失败</span>
            <button type="button" @click="reload">重新读取</button>
          </template>
          <template v-else>还没有浏览器档案。创建后启动 Chromium 完成该档案自己的登录。</template>
        </div>
      </section>
    </section>

    <aside v-if="error" class="error-toast" role="alert">
      <span>{{ error }}</span>
      <button aria-label="关闭错误提示" @click="clearError">×</button>
    </aside>
  </main>
</template>

<style scoped>
.browser-workspace { min-width: 0; min-height: 0; padding: 26px; overflow: auto; color: #dce5dd; background: #0e140f; }
.browser-header { padding-bottom: 22px; display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 1px solid #334035; }
.browser-header p { margin: 0 0 5px; color: #91a88d; font-size: 8px; font-weight: 800; letter-spacing: .18em; }.browser-header h2 { margin: 0; color: #f0f4f0; font-family: "Songti SC", serif; font-size: 25px; }.browser-header span { display: block; max-width: 630px; margin-top: 9px; color: #8e9d90; font-size: 11px; line-height: 1.6; }
.profile-count { padding: 12px 14px; display: grid; grid-template-columns: auto auto; gap: 0 8px; align-items: center; border: 1px solid #445147; color: var(--acid); }.profile-count strong { font-size: 20px; }.profile-count small { grid-column: 1 / -1; color: #a9b7aa; font-size: 8px; letter-spacing: .1em; }
.browser-grid { margin-top: 22px; display: grid; grid-template-columns: minmax(320px, 410px) minmax(0, 1fr); gap: 18px; }.browser-grid h3 { margin: 0 0 11px; color: #dae4db; font-size: 12px; }
.notice { margin: 13px 0 0; padding: 12px; display: flex; gap: 8px; color: #a9b8aa; border-left: 2px solid #708b69; background: #172019; font-size: 10px; line-height: 1.55; }.notice svg { flex: 0 0 auto; color: var(--acid); }
.list-heading { margin-bottom: 11px; display: flex; align-items: center; justify-content: space-between; }.list-heading span { color: #819082; font-size: 9px; }
.empty-state { min-height: 180px; padding: 20px; display: grid; place-content: center; justify-items: center; gap: 12px; border: 1px dashed #405045; color: #8b998d; font-size: 11px; text-align: center; }.empty-state button { min-height: 32px; padding: 0 12px; border: 1px solid #708b69; color: #dce5dd; background: #172019; }
.error-toast { position: fixed; z-index: 90; right: 20px; bottom: 20px; width: min(360px, calc(100vw - 40px)); padding: 12px; display: flex; gap: 10px; color: #f5e8e8; background: #762f31; border-left: 4px solid #ef9ba0; font-size: 10px; }.error-toast span { flex: 1; }.error-toast button { border: 0; color: inherit; background: transparent; font-size: 18px; }
@media (max-width: 1040px) { .browser-grid { grid-template-columns: 1fr; } }
</style>
