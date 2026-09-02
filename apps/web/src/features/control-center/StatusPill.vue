<script setup lang="ts">
import { computed } from 'vue'
import type { AccountStatus } from '@/types'

const props = defineProps<{ status: AccountStatus; compact?: boolean }>()

const label = computed(() => ({
  OFFLINE: '离线',
  STARTING: '启动中',
  QR_REQUIRED: '待扫码',
  ONLINE: '在线',
  ERROR: '异常',
})[props.status])
</script>

<template>
  <span class="status-pill" :class="[`is-${props.status.toLowerCase()}`, { compact: props.compact }]">
    <span class="status-dot" />
    {{ label }}
  </span>
</template>

<style scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid currentColor;
  color: #687269;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  white-space: nowrap;
}

.status-pill.compact { padding: 3px 6px; font-size: 9px; }
.status-dot { width: 6px; height: 6px; background: currentColor; border-radius: 50%; }
.is-online { color: #508720; }
.is-online .status-dot { box-shadow: 0 0 0 4px rgba(185, 243, 76, .2); }
.is-starting, .is-qr_required { color: #ad711a; }
.is-starting .status-dot { animation: status-pulse 1s infinite alternate; }
.is-error { color: var(--danger); }

@keyframes status-pulse { to { opacity: .25; } }
</style>
