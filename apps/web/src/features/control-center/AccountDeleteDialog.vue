<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { AlertTriangle, Trash2, X } from 'lucide-vue-next'
import type { Account } from '@/types'

const props = defineProps<{
  open: boolean
  account: Account | null
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [accountId: string]
}>()

const confirmation = shallowRef('')
const canDelete = computed(
  () => Boolean(props.account) && confirmation.value === props.account?.name && !props.busy,
)

watch(
  () => [props.open, props.account?.id] as const,
  () => {
    confirmation.value = ''
  },
)

function confirmDelete(): void {
  if (props.account && canDelete.value) emit('confirm', props.account.id)
}
</script>

<template>
  <div v-if="props.open" class="dialog-backdrop" @click.self="emit('close')">
    <section class="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
      <header class="dialog-header">
        <div class="warning-mark"><AlertTriangle :size="22" /></div>
        <div>
          <p>DESTRUCTIVE OPERATION</p>
          <h2 id="delete-title">永久删除 Evolution 实例</h2>
        </div>
        <button class="close-button" aria-label="关闭" :disabled="props.busy" @click="emit('close')">
          <X :size="18" />
        </button>
      </header>

      <div class="dialog-body">
        <strong>{{ props.account?.name }}</strong>
        <code>{{ props.account?.evolution.instanceName }}</code>
        <p>该操作会先注销 WhatsApp 会话，再删除 Evolution 实例及云中控中的会话、消息和媒体，无法撤销。</p>
        <label for="delete-confirmation">输入账号名称 <b>{{ props.account?.name }}</b> 以确认</label>
        <input
          id="delete-confirmation"
          v-model="confirmation"
          type="text"
          autocomplete="off"
          :disabled="props.busy"
          @keydown.enter="confirmDelete"
        />
      </div>

      <footer class="dialog-actions">
        <button class="secondary" :disabled="props.busy" @click="emit('close')">取消</button>
        <button class="danger" :disabled="!canDelete" @click="confirmDelete">
          <Trash2 :size="14" /> {{ props.busy ? '正在删除…' : '永久删除实例' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: fixed; inset: 0; z-index: 78; display: grid; place-items: center; padding: 24px; background: rgba(5, 7, 5, .82); backdrop-filter: blur(7px); }
.delete-dialog { width: min(520px, 100%); color: #edf0ed; background: #1c1718; border: 1px solid #75474a; box-shadow: 0 30px 90px rgba(0, 0, 0, .5); }
.dialog-header { min-height: 76px; padding: 15px 17px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; border-bottom: 1px solid #513235; }
.warning-mark { width: 39px; height: 39px; display: grid; place-items: center; color: #ffafb2; background: #442629; }
.dialog-header p { margin: 0 0 3px; color: #ba7d81; font-size: 7px; font-weight: 800; letter-spacing: .2em; }
.dialog-header h2 { margin: 0; font-family: "Songti SC", serif; font-size: 20px; }
.close-button { width: 33px; height: 33px; border: 1px solid #674246; display: grid; place-items: center; color: #c9adaf; background: transparent; }
.dialog-body { padding: 20px 18px; display: grid; gap: 8px; }
.dialog-body strong { font-size: 14px; }
.dialog-body code { color: #d48d91; font-family: "Cascadia Code", monospace; font-size: 9px; overflow-wrap: anywhere; }
.dialog-body p { margin: 7px 0 11px; color: #bcaeb0; font-size: 10px; line-height: 1.7; }
.dialog-body label { color: #c9bdbf; font-size: 9px; }
.dialog-body label b { color: #ffb1b4; }
.dialog-body input { height: 39px; padding: 0 11px; border: 1px solid #684347; outline: none; color: #f3ecec; background: #271e20; font-size: 11px; }
.dialog-body input:focus { border-color: #d1777c; box-shadow: 0 0 0 2px rgba(209, 119, 124, .14); }
.dialog-actions { padding: 14px 18px 18px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #493033; }
.dialog-actions button { min-height: 37px; padding: 0 14px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 9px; }
.secondary { border: 1px solid #594144; color: #c4b8ba; background: transparent; }
.danger { border: 1px solid #d06c72; color: #fff; background: #9f3f45; font-weight: 800; }
.dialog-actions button:disabled, .close-button:disabled { opacity: .4; cursor: not-allowed; }
</style>
