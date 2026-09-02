<script setup lang="ts">
import { Boxes, Camera, MoreHorizontal, Plus, Power, Trash2 } from 'lucide-vue-next'
import type { Account } from '@/types'
import StatusPill from './StatusPill.vue'

const props = defineProps<{
  accounts: readonly Account[]
  selectedId: string | null
  busy: boolean
}>()

const emit = defineEmits<{
  select: [accountId: string]
  add: []
  connect: [account: Account]
  disconnect: [account: Account]
  delete: [account: Account]
  editProfile: [account: Account]
}>()

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase()
}
</script>

<template>
  <section class="account-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">INSTANCE FABRIC</p>
        <h2 class="panel-title">账号节点</h2>
      </div>
      <button class="square-action" aria-label="添加账号" @click="emit('add')">
        <Plus :size="17" />
      </button>
    </div>

    <div class="account-list">
      <article
        v-for="account in props.accounts"
        :key="account.id"
        class="account-card"
        :class="{ selected: account.id === props.selectedId }"
        @click="emit('select', account.id)"
      >
        <div class="account-topline">
          <div class="account-avatar">
            <img v-if="account.avatarUrl" :src="account.avatarUrl" :alt="`${account.name} 头像`" />
            <span v-else>{{ initials(account.name) }}</span>
          </div>
          <div class="account-identity">
            <strong class="account-name">{{ account.name }}</strong>
            <span class="account-phone">{{ account.phone ?? '等待绑定号码' }}</span>
          </div>
          <MoreHorizontal :size="16" class="more-icon" />
        </div>

        <div class="account-meta">
          <StatusPill :status="account.status" compact />
          <span class="mode-tag">
            <Boxes :size="11" /> EVOLUTION
          </span>
        </div>

        <div v-if="account.id === props.selectedId" class="account-expanded">
          <div class="profile-line">
            <span>INSTANCE</span>
            <code>{{ account.evolution.instanceName }}</code>
            <small v-if="account.evolution.instanceId">ID {{ account.evolution.instanceId }}</small>
          </div>
          <button
            class="account-action profile"
            :disabled="props.busy || account.status !== 'ONLINE'"
            @click.stop="emit('editProfile', account)"
          >
            <Camera :size="13" /> 修改账号头像
          </button>
          <button
            v-if="account.status === 'ONLINE'"
            class="account-action danger"
            :disabled="props.busy"
            @click.stop="emit('disconnect', account)"
          >
            <Power :size="13" /> 断开会话
          </button>
          <button
            v-else
            class="account-action"
            :disabled="props.busy"
            @click.stop="emit('connect', account)"
          >
            <Power :size="13" /> 启动登录
          </button>
          <button
            class="account-action permanent"
            :disabled="props.busy"
            @click.stop="emit('delete', account)"
          >
            <Trash2 :size="13" /> 永久删除实例
          </button>
        </div>
      </article>
    </div>

    <button class="add-account" @click="emit('add')">
      <Plus :size="15" /> 添加 Evolution 实例
    </button>
  </section>
</template>

<style scoped>
.account-panel {
  min-width: 0;
  padding: 22px 16px 16px;
  background: #182119;
  color: #edf1e9;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-heading { display: flex; align-items: center; justify-content: space-between; padding: 0 5px 17px; }
.eyebrow { margin: 0 0 4px; color: #8b9a8e; font-size: 9px; font-weight: 700; letter-spacing: .2em; }
.panel-title { margin: 0; font-family: "Songti SC", serif; font-size: 20px; font-weight: 600; }
.square-action { width: 32px; height: 32px; border: 1px solid #4a584c; color: var(--acid); background: transparent; display: grid; place-items: center; }
.square-action:hover { background: var(--acid); color: var(--ink); border-color: var(--acid); }
.account-list { display: grid; gap: 7px; min-height: 0; overflow-y: auto; padding-right: 2px; }
.account-card { padding: 13px; border: 1px solid transparent; background: #202b22; transition: border-color .18s, background .18s, transform .18s; cursor: pointer; }
.account-card:hover { transform: translateX(2px); border-color: #4a584c; }
.account-card.selected { border-color: var(--acid); background: #253128; }
.account-topline { display: flex; align-items: center; gap: 10px; }
.account-avatar { width: 34px; height: 34px; display: grid; place-items: center; flex: 0 0 auto; background: #dfe9d7; color: #172019; font-size: 11px; font-weight: 800; }
.account-avatar img { width: 100%; height: 100%; display: block; object-fit: cover; }
.account-identity { min-width: 0; flex: 1; display: grid; gap: 3px; }
.account-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.account-phone { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #99a49b; font-size: 10px; }
.more-icon { color: #778279; }
.account-meta { display: flex; align-items: center; gap: 7px; margin-top: 11px; }
.mode-tag { display: inline-flex; align-items: center; gap: 4px; color: #89968b; font-size: 9px; font-weight: 700; letter-spacing: .06em; }
.account-expanded { display: grid; gap: 9px; margin-top: 12px; padding-top: 11px; border-top: 1px solid #39453b; }
.profile-line { display: grid; gap: 3px; color: #768278; font-size: 8px; letter-spacing: .12em; }
.profile-line code { color: #b8c4ba; font-family: "Cascadia Code", monospace; font-size: 9px; letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; }
.profile-line small { color: #718077; font-family: "Cascadia Code", monospace; font-size: 7px; letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; }
.account-action { min-height: 31px; border: 0; background: #354336; color: #dfe8df; font-size: 10px; display: flex; justify-content: center; align-items: center; gap: 6px; }
.account-action:hover { background: #435345; }
.account-action.profile { color: var(--acid); }
.account-action.danger { color: #f1b4b4; }
.account-action.permanent { border: 1px solid #704346; color: #f2a4a7; background: transparent; }
.account-action.permanent:hover { border-color: #bd666b; background: #442628; }
.account-action:disabled { opacity: .55; cursor: wait; }
.add-account { margin-top: auto; padding: 12px; border: 1px dashed #536056; background: transparent; color: #aeb9b0; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 10px; }
.add-account:hover { color: var(--acid); border-color: var(--acid); }
</style>
