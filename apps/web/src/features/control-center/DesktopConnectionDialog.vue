<script setup lang="ts">
import { shallowRef, watch } from 'vue'

interface Props {
  open: boolean
  apiUrl: string
  busy: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  save: [apiUrl: string]
}>()

const draftApiUrl = shallowRef('')

watch(
  () => [props.open, props.apiUrl] as const,
  ([open, apiUrl]) => {
    if (open) draftApiUrl.value = apiUrl
  },
  { immediate: true },
)

function submit(): void {
  emit('save', draftApiUrl.value.trim())
}
</script>

<template>
  <div v-if="open" class="dialog-mask" role="presentation" @click.self="emit('close')">
    <section class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="desktop-settings-title">
      <header class="dialog-header">
        <div>
          <p class="eyebrow">DESKTOP CONNECTION</p>
          <h2 id="desktop-settings-title">控制服务连接</h2>
        </div>
        <button class="close-button" aria-label="关闭" :disabled="busy" @click="emit('close')">×</button>
      </header>
      <form class="dialog-form" @submit.prevent="submit">
        <label for="control-api-url">控制 API 地址</label>
        <input id="control-api-url" v-model="draftApiUrl" :disabled="busy" autocomplete="url" required />
        <p>生产环境请填写 HTTPS 地址；仅本机服务可使用 HTTP。</p>
        <footer class="dialog-actions">
          <button type="button" class="secondary" :disabled="busy" @click="emit('close')">取消</button>
          <button type="submit" class="primary" :disabled="busy">{{ busy ? '保存中…' : '保存并重连' }}</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.dialog-mask { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(4, 7, 5, .74); }
.dialog-panel { width: min(470px, 100%); color: #e8eee9; background: #151d17; border: 1px solid #465248; box-shadow: 0 24px 80px rgba(0, 0, 0, .45); }
.dialog-header { min-height: 80px; padding: 18px 20px; display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #364038; }
.eyebrow { margin: 0 0 5px; color: #94aa8e; font-size: 8px; font-weight: 700; letter-spacing: .18em; }.dialog-header h2 { margin: 0; font-family: "Songti SC", serif; font-size: 20px; font-weight: 600; }
.close-button { width: 30px; height: 30px; border: 1px solid #415047; color: #aebbae; background: transparent; font-size: 22px; line-height: 1; }.close-button:hover { color: #f0f4f0; border-color: #8ca087; }
.dialog-form { padding: 20px; display: grid; gap: 9px; }.dialog-form label { color: #c2cdc3; font-size: 10px; font-weight: 700; letter-spacing: .08em; }.dialog-form input { width: 100%; min-height: 40px; padding: 0 11px; border: 1px solid #506054; color: #eaf0eb; background: #0e140f; font-family: "Cascadia Code", monospace; font-size: 12px; outline: none; }.dialog-form input:focus { border-color: var(--acid); box-shadow: 0 0 0 2px rgba(185, 243, 76, .14); }.dialog-form p { margin: 1px 0 4px; color: #8d9a90; font-size: 10px; line-height: 1.6; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 9px; }.dialog-actions button { min-height: 34px; padding: 0 13px; border: 1px solid #566359; font-size: 10px; font-weight: 700; letter-spacing: .06em; }.secondary { color: #c5d0c6; background: transparent; }.primary { color: #101610; background: var(--acid); border-color: var(--acid) !important; }.dialog-actions button:disabled, .close-button:disabled { cursor: not-allowed; opacity: .55; }
</style>
