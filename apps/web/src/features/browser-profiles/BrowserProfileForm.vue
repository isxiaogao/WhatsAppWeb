<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { BrowserProfile, BrowserProfileInput } from '@/desktop'

const props = defineProps<{ busy: boolean; profile: BrowserProfile | null }>()
const emit = defineEmits<{
  submit: [input: BrowserProfileInput]
  cancel: []
}>()

const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN'
const timezones =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'America/New_York', 'Europe/London']
const editing = computed(() => props.profile !== null)

const form = reactive<BrowserProfileInput>(emptyForm())

watch(
  () => props.profile,
  (profile) => Object.assign(form, profile ? formForProfile(profile) : emptyForm()),
  { immediate: true },
)

function submit(): void {
  emit('submit', { ...form })
}

function emptyForm(): BrowserProfileInput {
  return {
    name: '',
    owner: '',
    purpose: 'WhatsApp 客服会话',
    browser: 'chrome',
    proxyUrl: '',
    proxyUsername: '',
    proxyPassword: '',
    clearProxyPassword: false,
    startUrl: 'https://web.whatsapp.com/',
    timezone: systemTimezone,
    locale: systemLocale,
    fingerprintMode: 'enhanced',
  }
}

function formForProfile(profile: BrowserProfile): BrowserProfileInput {
  return {
    name: profile.name,
    owner: profile.owner,
    purpose: profile.purpose,
    browser: profile.browser,
    proxyUrl: profile.proxyUrl ?? '',
    proxyUsername: profile.proxyUsername ?? '',
    proxyPassword: '',
    clearProxyPassword: false,
    startUrl: profile.startUrl,
    timezone: profile.timezone,
    locale: profile.locale,
    fingerprintMode: profile.fingerprintMode,
  }
}
</script>

<template>
  <form class="profile-form" @submit.prevent="submit">
    <label class="form-field">
      <span>浏览器名称</span>
      <input v-model="form.name" :disabled="busy" maxlength="80" required placeholder="例如：客服一组" />
    </label>
    <label class="form-field">
      <span>责任人</span>
      <input v-model="form.owner" :disabled="busy" maxlength="80" required placeholder="例如：运营-张三" />
    </label>
    <label class="form-field">
      <span>用途</span>
      <input v-model="form.purpose" :disabled="busy" maxlength="80" required />
    </label>
    <label class="form-field">
      <span>Chromium 内核</span>
      <select v-model="form.browser" :disabled="busy">
        <option value="chrome">Google Chrome</option>
        <option value="edge">Microsoft Edge</option>
      </select>
    </label>
    <label class="form-field">
      <span>指纹模式</span>
      <select v-model="form.fingerprintMode" :disabled="busy">
        <option value="enhanced">固定增强指纹</option>
        <option value="native">本机原生指纹</option>
      </select>
      <small>增强模式为每个档案固定生成一次设备参数；原生模式遵循 Patchright 的最小修改建议。</small>
    </label>
    <label class="form-field">
      <span>代理地址 <small>可选</small></span>
      <input
        v-model="form.proxyUrl"
        :disabled="busy"
        maxlength="2048"
        spellcheck="false"
        placeholder="例如：http://127.0.0.1:7890"
      />
    </label>
    <div class="proxy-fields">
      <label class="form-field">
        <span>代理用户名</span>
        <input v-model="form.proxyUsername" :disabled="busy" maxlength="128" autocomplete="off" />
      </label>
      <label class="form-field">
        <span>代理密码</span>
        <input
          v-model="form.proxyPassword"
          :disabled="busy || form.clearProxyPassword"
          maxlength="256"
          type="password"
          autocomplete="new-password"
          :placeholder="profile?.hasProxyPassword ? '留空则保留原密码' : ''"
        />
      </label>
    </div>
    <label v-if="profile?.hasProxyPassword" class="check-field">
      <input v-model="form.clearProxyPassword" :disabled="busy" type="checkbox" />
      <span>清除已保存的代理密码</span>
    </label>
    <label class="form-field">
      <span>打开网站</span>
      <input
        v-model="form.startUrl"
        :disabled="busy"
        maxlength="2048"
        required
        spellcheck="false"
        type="url"
        placeholder="https://web.whatsapp.com/"
      />
    </label>
    <div class="environment-fields">
      <label class="form-field">
        <span>时区</span>
        <input
          v-model="form.timezone"
          :disabled="busy"
          list="browser-profile-timezones"
          maxlength="100"
          required
          spellcheck="false"
          placeholder="Asia/Shanghai"
        />
      </label>
      <label class="form-field">
        <span>语言地区</span>
        <input v-model="form.locale" :disabled="busy" maxlength="80" required placeholder="zh-CN" />
      </label>
    </div>
    <datalist id="browser-profile-timezones">
      <option v-for="timezone in timezones" :key="timezone" :value="timezone" />
    </datalist>
    <div class="form-actions">
      <button v-if="editing" class="cancel-button" :disabled="busy" type="button" @click="emit('cancel')">
        取消编辑
      </button>
      <button class="submit-button" :disabled="busy" type="submit">
        {{ busy ? '处理中…' : editing ? '保存档案' : '创建独立档案' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.profile-form { padding: 18px; display: grid; gap: 12px; border: 1px solid #354137; background: #151d17; }
.form-field { display: grid; gap: 6px; color: #b9c6ba; font-size: 10px; font-weight: 700; letter-spacing: .07em; }
.form-field small { color: #778478; font-size: 8px; font-weight: 500; line-height: 1.5; letter-spacing: 0; }
.form-field input, .form-field select { min-width: 0; min-height: 38px; padding: 0 10px; border: 1px solid #4a584d; color: #e6eee7; background: #0d130e; font-family: inherit; outline: 0; }
.form-field input:focus, .form-field select:focus { border-color: var(--acid); }
.proxy-fields, .environment-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.check-field { display: flex; align-items: center; gap: 8px; color: #aab7ab; font-size: 9px; }
.check-field input { accent-color: var(--acid); }
.form-actions { display: grid; grid-template-columns: auto 1fr; gap: 8px; }
.submit-button, .cancel-button { min-height: 38px; padding: 0 12px; font-size: 10px; font-weight: 800; letter-spacing: .08em; }
.submit-button { border: 1px solid var(--acid); color: #111710; background: var(--acid); }
.cancel-button { border: 1px solid #566359; color: #c7d2c8; background: transparent; }
.submit-button:disabled, .cancel-button:disabled { opacity: .55; }
@media (max-width: 620px) { .proxy-fields, .environment-fields { grid-template-columns: 1fr; } }
</style>
