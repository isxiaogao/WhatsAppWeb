<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import {
  CheckCircle2,
  Boxes,
  LoaderCircle,
  QrCode,
  ShieldCheck,
  X,
} from 'lucide-vue-next'
import type { Account } from '@/types'
import StatusPill from './StatusPill.vue'

const props = defineProps<{
  open: boolean
  account: Account | null
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  create: [input: { name: string }]
}>()

const name = shallowRef('运营账号 02')

watch(
  () => props.open,
  (open) => {
    if (open && !props.account) {
      name.value = '运营账号 02'
    }
  },
)

function submit(): void {
  if (!name.value.trim() || props.busy) return
  emit('create', { name: name.value.trim() })
}
</script>

<template>
  <div v-if="props.open" class="dialog-backdrop" @click.self="emit('close')">
    <section class="connect-dialog" role="dialog" aria-modal="true" aria-label="连接 WhatsApp 账号">
      <header class="dialog-header">
        <div>
          <p class="dialog-kicker">SESSION PROVISIONING / 01</p>
          <h2>{{ props.account ? '连接账号' : '创建 Evolution 实例' }}</h2>
        </div>
        <button class="close-button" aria-label="关闭" @click="emit('close')"><X :size="19" /></button>
      </header>

      <form v-if="!props.account" class="create-form" @submit.prevent="submit">
        <label class="field-label">
          <span>节点名称</span>
          <input v-model="name" maxlength="40" autocomplete="off" />
        </label>

        <fieldset class="provider-choice">
          <legend>真实会话 Provider</legend>
          <div class="provider-card selected">
            <span class="provider-icon"><Boxes :size="19" /></span>
            <span class="provider-copy">
              <strong>EVOLUTION API + BAILEYS</strong>
              <small>创建独立 WHATSAPP-BAILEYS instance，由 Evolution 维护真实会话并等待手机扫码</small>
            </span>
            <span class="choice-mark" />
          </div>
        </fieldset>

        <div class="profile-preview">
          <div><span>INTEGRATION</span><strong>BAILEYS</strong></div>
          <div><span>SESSION STORE</span><strong>POSTGRES</strong></div>
          <div><span>EVENT MODE</span><strong>WEBHOOK</strong></div>
        </div>

        <div class="safety-note">
          <ShieldCheck :size="17" />
          <p><strong>实例隔离原则</strong><span>一个账号绑定一个 Evolution instance，不让多个 Worker 同时持有同一会话。</span></p>
        </div>

        <button class="primary-action" type="submit" :disabled="props.busy || !name.trim()">
          <LoaderCircle v-if="props.busy" :size="17" class="spinning" />
          <QrCode v-else :size="17" />
          创建节点并生成登录会话
        </button>
      </form>

      <div v-else class="login-stage">
        <div class="account-summary">
          <div>
            <span class="summary-label">ACCOUNT NODE</span>
            <strong>{{ props.account.name }}</strong>
            <small>{{ props.account.phone ?? props.account.evolution.instanceName }}</small>
          </div>
          <StatusPill :status="props.account.status" />
        </div>

        <div v-if="props.account.status === 'ONLINE'" class="success-state">
          <CheckCircle2 :size="48" />
          <h3>会话已上线</h3>
          <p>Evolution 会持久保存该实例，下次启动会自动恢复连接状态。</p>
          <button class="primary-action" @click="emit('close')">进入消息中控</button>
        </div>

        <template v-else>
          <div class="qr-stage">
            <div class="qr-frame">
              <img v-if="props.account.qrDataUrl" :src="props.account.qrDataUrl" alt="WhatsApp 登录二维码" />
              <div v-else class="qr-loading">
                <LoaderCircle :size="32" class="spinning" />
                <span>Evolution 正在创建登录二维码</span>
              </div>
            </div>
            <div class="scan-instructions">
              <span class="step-number">01</span><p>手机打开 WhatsApp</p>
              <span class="step-number">02</span><p>进入「已关联设备」</p>
              <span class="step-number">03</span><p>扫描左侧二维码</p>
            </div>
          </div>

          <p v-if="props.account.error" class="error-copy">{{ props.account.error }}</p>
          <p class="mode-disclaimer">
            二维码由该账号独占的 Evolution/Baileys 实例生成；首次必须由账号持有人扫码授权。
          </p>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 22px; background: rgba(3, 7, 4, .76); backdrop-filter: blur(9px); animation: backdrop-in .2s ease-out; }
.connect-dialog { width: min(690px, 100%); max-height: calc(100vh - 44px); overflow-y: auto; background: var(--paper-bright); border: 1px solid #758078; box-shadow: 0 30px 90px rgba(0, 0, 0, .42); animation: dialog-in .24s ease-out; }
.dialog-header { min-height: 86px; padding: 20px 23px; display: flex; align-items: center; justify-content: space-between; color: #edf2eb; background: var(--ink); }
.dialog-kicker { margin: 0 0 5px; color: var(--acid); font-size: 8px; font-weight: 800; letter-spacing: .2em; }
.dialog-header h2 { margin: 0; font-family: "Songti SC", serif; font-size: 24px; font-weight: 600; }
.close-button { width: 35px; height: 35px; border: 1px solid #526056; background: transparent; color: #d8e0d9; display: grid; place-items: center; }
.close-button:hover { border-color: var(--acid); color: var(--acid); }
.create-form, .login-stage { padding: 24px; }
.field-label { display: grid; gap: 8px; color: #616a63; font-size: 9px; font-weight: 700; letter-spacing: .12em; }
.field-label input { height: 44px; border: 1px solid #bfc1ba; background: #eeebe3; padding: 0 13px; color: var(--ink); font-size: 13px; letter-spacing: 0; }
.provider-choice { display: grid; grid-template-columns: 1fr; gap: 9px; margin: 21px 0 0; padding: 19px 0 0; border: 0; border-top: 1px solid var(--line); }
.provider-choice legend { padding: 0; color: #616a63; font-size: 9px; font-weight: 700; letter-spacing: .12em; }
.provider-card { position: relative; min-height: 86px; padding: 14px; border: 1px solid #c1c3bc; display: flex; align-items: flex-start; gap: 11px; }
.provider-card.selected { border: 2px solid var(--ink); padding: 13px; background: #ece9e0; }
.provider-icon { width: 32px; height: 32px; flex: 0 0 auto; display: grid; place-items: center; background: var(--ink); color: var(--acid); }
.provider-copy { min-width: 0; display: grid; gap: 5px; }
.provider-copy strong { font-size: 10px; letter-spacing: .05em; }.provider-copy small { color: #747c75; font-size: 9px; line-height: 1.5; }
.choice-mark { position: absolute; top: 10px; right: 10px; width: 9px; height: 9px; border: 1px solid #929891; border-radius: 50%; }
.selected .choice-mark { border: 3px solid var(--ink); background: var(--acid); }
.profile-preview { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 13px; border: 1px solid var(--line); }
.profile-preview div { padding: 11px; display: grid; gap: 4px; border-right: 1px solid var(--line); }.profile-preview div:last-child { border-right: 0; }
.profile-preview span { color: #929790; font-size: 7px; letter-spacing: .14em; }.profile-preview strong { font-family: "Cascadia Code", monospace; font-size: 9px; }
.safety-note { margin-top: 14px; padding: 12px 14px; display: flex; align-items: flex-start; gap: 10px; background: #e6edd8; color: #4c633a; }
.safety-note p { margin: 0; display: grid; gap: 3px; }.safety-note strong { font-size: 10px; }.safety-note span { color: #65725c; font-size: 9px; line-height: 1.45; }
.primary-action { width: 100%; min-height: 45px; margin-top: 18px; border: 1px solid var(--ink); background: var(--ink); color: var(--acid); display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11px; font-weight: 700; }
.primary-action:hover:not(:disabled) { background: var(--acid); color: var(--ink); border-color: var(--acid-deep); }.primary-action:disabled { opacity: .55; cursor: wait; }
.account-summary { padding-bottom: 17px; display: flex; align-items: center; justify-content: space-between; gap: 15px; border-bottom: 1px solid var(--line); }
.account-summary > div { display: grid; gap: 3px; }.summary-label { color: #8a918a; font-size: 8px; letter-spacing: .16em; }.account-summary strong { font-size: 14px; }.account-summary small { color: #798079; font-family: "Cascadia Code", monospace; font-size: 9px; }
.qr-stage { display: grid; grid-template-columns: 290px 1fr; gap: 27px; align-items: center; margin-top: 22px; }
.qr-frame { width: 290px; height: 290px; padding: 14px; border: 1px solid #b6b9b2; background: #f1eee7; display: grid; place-items: center; position: relative; }
.qr-frame::before, .qr-frame::after { content: ''; position: absolute; width: 26px; height: 26px; border-color: var(--ink); }
.qr-frame::before { top: -1px; left: -1px; border-top: 3px solid; border-left: 3px solid; }.qr-frame::after { right: -1px; bottom: -1px; border-right: 3px solid; border-bottom: 3px solid; }
.qr-frame img { width: 100%; height: 100%; object-fit: contain; image-rendering: crisp-edges; }
.qr-loading { display: grid; justify-items: center; gap: 12px; color: #7a827b; font-size: 9px; text-align: center; }
.scan-instructions { display: grid; grid-template-columns: 29px 1fr; align-items: center; gap: 12px 9px; }.step-number { width: 29px; height: 29px; display: grid; place-items: center; background: #dfe6d1; color: #496021; font-size: 9px; font-weight: 800; }.scan-instructions p { margin: 0; font-size: 11px; }
.mode-disclaimer { margin: 17px 0 0; padding: 10px 12px; border-left: 3px solid var(--amber); background: #eee4d1; color: #786746; font-size: 9px; line-height: 1.55; }
.error-copy { margin: 14px 0 0; color: var(--danger); font-size: 10px; }
.success-state { min-height: 340px; display: grid; place-content: center; justify-items: center; text-align: center; color: #568527; }.success-state h3 { margin: 16px 0 6px; color: var(--ink); font-family: "Songti SC", serif; font-size: 25px; }.success-state p { max-width: 360px; margin: 0; color: #737b74; font-size: 10px; line-height: 1.55; }.success-state .primary-action { width: 260px; }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes backdrop-in { from { opacity: 0; } }
@keyframes dialog-in { from { opacity: 0; transform: translateY(12px) scale(.985); } }
@media (max-width: 650px) { .provider-choice, .qr-stage { grid-template-columns: 1fr; }.qr-frame { width: min(290px, 100%); height: auto; aspect-ratio: 1; margin: auto; }.profile-preview { grid-template-columns: 1fr; }.profile-preview div { border-right: 0; border-bottom: 1px solid var(--line); } }
</style>
