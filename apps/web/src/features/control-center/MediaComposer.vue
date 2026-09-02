<script setup lang="ts">
import { computed, onUnmounted, shallowRef, useTemplateRef } from 'vue'
import { Film, ImagePlus, Paperclip, Send, X } from 'lucide-vue-next'

const props = defineProps<{
  disabled: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  send: [file: File, caption: string]
  error: [message: string]
}>()

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const selectedFile = shallowRef<File | null>(null)
const previewUrl = shallowRef<string | null>(null)
const caption = shallowRef('')

const isVideo = computed(() => selectedFile.value?.type === 'video/mp4')
const sizeLabel = computed(() => {
  const bytes = selectedFile.value?.size ?? 0
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
})

onUnmounted(clearSelection)

function openPicker(): void {
  if (!props.disabled && !props.busy) fileInput.value?.click()
}

function handleSelection(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  const video = file.type === 'video/mp4'
  if (!isImage && !video) {
    emit('error', '仅支持 JPEG、PNG、WebP 图片和 MP4 视频')
    return
  }
  const limit = video ? 64 * 1024 * 1024 : 10 * 1024 * 1024
  if (file.size > limit) {
    emit('error', video ? '视频不能超过 64 MB' : '图片不能超过 10 MB')
    return
  }
  clearPreviewUrl()
  selectedFile.value = file
  previewUrl.value = URL.createObjectURL(file)
}

function submit(): void {
  const file = selectedFile.value
  if (!file || props.disabled || props.busy) return
  emit('send', file, caption.value.trim())
  clearSelection()
}

function clearSelection(): void {
  clearPreviewUrl()
  selectedFile.value = null
  caption.value = ''
}

function clearPreviewUrl(): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
}
</script>

<template>
  <div class="media-composer">
    <input
      ref="fileInput"
      class="file-input"
      type="file"
      accept="image/jpeg,image/png,image/webp,video/mp4"
      @change="handleSelection"
    />
    <button
      class="tool-button"
      type="button"
      aria-label="添加图片或视频"
      :disabled="props.disabled || props.busy"
      @click="openPicker"
    >
      <Paperclip :size="18" />
    </button>

    <section v-if="selectedFile" class="media-draft" aria-label="媒体预览">
      <div class="preview-stage">
        <video v-if="isVideo" :src="previewUrl ?? undefined" muted playsinline />
        <img v-else :src="previewUrl ?? undefined" alt="待发送图片预览" />
        <span class="media-badge">
          <Film v-if="isVideo" :size="12" />
          <ImagePlus v-else :size="12" />
          {{ isVideo ? 'VIDEO' : 'IMAGE' }}
        </span>
      </div>
      <div class="draft-copy">
        <strong>{{ selectedFile.name }}</strong>
        <span>{{ sizeLabel }} · {{ selectedFile.type }}</span>
        <textarea
          v-model="caption"
          maxlength="1024"
          rows="2"
          placeholder="添加说明文字（可选）"
        />
      </div>
      <div class="draft-actions">
        <button type="button" aria-label="取消媒体" @click="clearSelection"><X :size="15" /></button>
        <button class="confirm" type="button" :disabled="props.busy" @click="submit">
          <Send :size="14" /> 发送
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.media-composer { position: relative; flex: 0 0 auto; }
.file-input { display: none; }
.tool-button { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid #bebfb8; background: transparent; color: #6d766f; }
.tool-button:hover:not(:disabled) { border-color: var(--ink); color: var(--ink); }
.tool-button:disabled { opacity: .36; cursor: not-allowed; }
.media-draft { position: absolute; z-index: 20; left: 0; bottom: 51px; width: min(510px, calc(100vw - 690px)); min-width: 360px; padding: 10px; display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; gap: 11px; color: #e9efe9; background: #151d17; border: 1px solid #465249; box-shadow: 0 20px 45px rgba(8, 12, 9, .3); }
.preview-stage { position: relative; height: 86px; overflow: hidden; background: #0a0e0b; }
.preview-stage img, .preview-stage video { width: 100%; height: 100%; display: block; object-fit: cover; }
.media-badge { position: absolute; left: 5px; bottom: 5px; padding: 3px 5px; display: inline-flex; align-items: center; gap: 4px; color: var(--acid); background: rgba(9, 14, 10, .82); font-size: 7px; font-weight: 800; letter-spacing: .1em; }
.draft-copy { min-width: 0; display: grid; align-content: start; gap: 4px; }
.draft-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.draft-copy span { color: #8d998f; font-size: 8px; }
.draft-copy textarea { min-height: 43px; resize: none; border: 1px solid #3e4941; padding: 7px 8px; color: #e6ece7; background: #202a22; font-size: 9px; }
.draft-actions { display: grid; align-content: space-between; justify-items: end; }
.draft-actions button { min-width: 30px; min-height: 30px; border: 1px solid #48544a; display: inline-flex; align-items: center; justify-content: center; gap: 5px; color: #a9b4ab; background: transparent; font-size: 8px; }
.draft-actions .confirm { padding: 0 9px; border-color: var(--acid); color: var(--ink); background: var(--acid); font-weight: 800; }
@media (max-width: 1120px) { .media-draft { width: 430px; } }
</style>
