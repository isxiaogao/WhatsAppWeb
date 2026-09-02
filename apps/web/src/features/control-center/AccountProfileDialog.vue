<script setup lang="ts">
import { computed, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import { Camera, ImageUp, Trash2, X } from 'lucide-vue-next'
import type { Account } from '@/types'

const props = defineProps<{
  open: boolean
  account: Account | null
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [accountId: string, file: File]
  remove: [accountId: string]
  error: [message: string]
}>()

const fileInput = useTemplateRef<HTMLInputElement>('avatarInput')
const selectedFile = shallowRef<File | null>(null)
const previewUrl = shallowRef<string | null>(null)
const processing = shallowRef(false)
const displayAvatar = computed(() => previewUrl.value ?? props.account?.avatarUrl ?? null)

watch(
  () => props.open,
  (open) => {
    if (!open) clearSelection()
  },
)
onUnmounted(clearSelection)

function openPicker(): void {
  if (!props.busy && !processing.value) fileInput.value?.click()
}

function handleSelection(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    emit('error', '头像仅支持 JPEG、PNG 或 WebP 图片')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    emit('error', '头像图片不能超过 5 MB')
    return
  }
  clearPreviewUrl()
  selectedFile.value = file
  previewUrl.value = URL.createObjectURL(file)
}

async function save(): Promise<void> {
  const account = props.account
  const file = selectedFile.value
  if (!account || !file || props.busy || processing.value) return
  processing.value = true
  try {
    emit('save', account.id, await cropSquare(file))
  } catch {
    emit('error', '头像图片无法处理，请换一张图片')
  } finally {
    processing.value = false
  }
}

function remove(): void {
  if (props.account && !props.busy) emit('remove', props.account.id)
}

function clearSelection(): void {
  clearPreviewUrl()
  selectedFile.value = null
}

function clearPreviewUrl(): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
}

async function cropSquare(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas unavailable')
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      512,
      512,
    )
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('encode failed'))), 'image/jpeg', .9)
    })
    return new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}
</script>

<template>
  <div v-if="props.open" class="dialog-backdrop" @click.self="emit('close')">
    <section class="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <header class="dialog-header">
        <div>
          <p>IDENTITY SURFACE</p>
          <h2 id="profile-title">账号头像</h2>
        </div>
        <button aria-label="关闭" @click="emit('close')"><X :size="18" /></button>
      </header>

      <div class="avatar-stage">
        <div class="avatar-frame">
          <img v-if="displayAvatar" :src="displayAvatar" alt="账号头像预览" />
          <Camera v-else :size="34" />
        </div>
        <span>512 × 512 CENTER CROP</span>
      </div>

      <div class="profile-copy">
        <strong>{{ props.account?.name }}</strong>
        <span>{{ props.account?.phone }}</span>
        <p>图片会在浏览器内居中裁剪为正方形，再通过该账号独立的 Evolution instance 更新。</p>
      </div>

      <input
        ref="avatarInput"
        class="file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        @change="handleSelection"
      />
      <div class="dialog-actions">
        <button class="secondary" :disabled="props.busy || processing" @click="openPicker">
          <ImageUp :size="15" /> 选择图片
        </button>
        <button
          v-if="props.account?.avatarUrl"
          class="remove"
          :disabled="props.busy || processing"
          @click="remove"
        >
          <Trash2 :size="14" /> 移除
        </button>
        <button class="primary" :disabled="!selectedFile || props.busy || processing" @click="save">
          {{ props.busy || processing ? '正在同步…' : '更新 WhatsApp 头像' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: fixed; inset: 0; z-index: 75; display: grid; place-items: center; padding: 24px; background: rgba(5, 9, 6, .76); backdrop-filter: blur(7px); }
.profile-dialog { width: min(520px, 100%); color: #e9eee9; background: #151d17; border: 1px solid #4a574c; box-shadow: 0 30px 90px rgba(0, 0, 0, .42); }
.dialog-header { min-height: 70px; padding: 15px 17px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #364138; }
.dialog-header p { margin: 0 0 3px; color: #7f8d82; font-size: 7px; font-weight: 800; letter-spacing: .2em; }
.dialog-header h2 { margin: 0; font-family: "Songti SC", serif; font-size: 21px; }
.dialog-header button { width: 33px; height: 33px; border: 1px solid #465248; display: grid; place-items: center; color: #aab4ac; background: transparent; }
.avatar-stage { padding: 26px; display: grid; place-items: center; gap: 10px; background-image: linear-gradient(rgba(185, 243, 76, .045) 1px, transparent 1px), linear-gradient(90deg, rgba(185, 243, 76, .045) 1px, transparent 1px); background-size: 24px 24px; }
.avatar-frame { width: 168px; height: 168px; display: grid; place-items: center; overflow: hidden; color: #667268; background: #0d130f; border: 1px solid #536057; border-radius: 50%; box-shadow: 0 0 0 8px rgba(185, 243, 76, .055); }
.avatar-frame img { width: 100%; height: 100%; object-fit: cover; }
.avatar-stage span { color: #7f8c82; font-family: "Cascadia Code", monospace; font-size: 7px; letter-spacing: .13em; }
.profile-copy { padding: 15px 18px; display: grid; gap: 4px; border-top: 1px solid #354038; }
.profile-copy strong { font-size: 13px; }.profile-copy span { color: var(--acid); font-size: 9px; }.profile-copy p { margin: 7px 0 0; color: #8d998f; font-size: 9px; line-height: 1.6; }
.file-input { display: none; }
.dialog-actions { padding: 14px 18px 18px; display: flex; gap: 8px; }
.dialog-actions button { min-height: 37px; padding: 0 12px; border: 1px solid #49564b; display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #bbc5bd; background: transparent; font-size: 9px; }
.dialog-actions .remove { color: #efaaaa; }.dialog-actions .primary { margin-left: auto; border-color: var(--acid); color: var(--ink); background: var(--acid); font-weight: 800; }
.dialog-actions button:disabled { opacity: .4; cursor: wait; }
</style>
