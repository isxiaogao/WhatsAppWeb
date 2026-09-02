import { onMounted, onUnmounted, readonly, shallowRef } from 'vue'
import type { BrowserProfile, BrowserProfileInput } from '@/desktop'

type ProfileOperation = 'start' | 'stop' | 'update' | 'delete'

interface BusyProfile {
  id: string
  operation: ProfileOperation
}

const REFRESH_INTERVAL_MS = 3_000

export function useBrowserProfiles() {
  const profiles = shallowRef<BrowserProfile[]>([])
  const loading = shallowRef(true)
  const creating = shallowRef(false)
  const busyProfile = shallowRef<BusyProfile | null>(null)
  const error = shallowRef<string | null>(null)
  let refreshTimer: ReturnType<typeof setInterval> | null = null

  async function load(options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) loading.value = true
    try {
      profiles.value = await getBrowserProfilesBridge().listBrowserProfiles()
      if (!options.silent) error.value = null
    } catch (reason) {
      if (!options.silent) error.value = messageFor(reason)
    } finally {
      if (!options.silent) loading.value = false
    }
  }

  async function create(input: BrowserProfileInput): Promise<BrowserProfile> {
    if (creating.value) throw new Error('浏览器档案正在创建')
    creating.value = true
    error.value = null
    try {
      const created = await getBrowserProfilesBridge().createBrowserProfile(input)
      profiles.value = [created, ...profiles.value]
      return created
    } catch (reason) {
      error.value = messageFor(reason)
      throw reason
    } finally {
      creating.value = false
    }
  }

  async function update(profileId: string, input: BrowserProfileInput): Promise<BrowserProfile> {
    return runProfileOperation(profileId, 'update', async () =>
      getBrowserProfilesBridge().updateBrowserProfile(profileId, input),
    )
  }

  async function remove(profileId: string): Promise<void> {
    await runProfileOperation(profileId, 'delete', async () => {
      await getBrowserProfilesBridge().deleteBrowserProfile(profileId)
      profiles.value = profiles.value.filter((profile) => profile.id !== profileId)
    })
  }

  async function start(profileId: string): Promise<BrowserProfile> {
    return runProfileOperation(profileId, 'start', async () =>
      getBrowserProfilesBridge().startBrowserProfile(profileId),
    )
  }

  async function stop(profileId: string): Promise<BrowserProfile> {
    return runProfileOperation(profileId, 'stop', async () =>
      getBrowserProfilesBridge().stopBrowserProfile(profileId),
    )
  }

  async function runProfileOperation<T>(
    profileId: string,
    operation: ProfileOperation,
    action: () => Promise<T>,
  ): Promise<T> {
    if (busyProfile.value) throw new Error('另一个浏览器档案操作正在进行')
    busyProfile.value = { id: profileId, operation }
    error.value = null
    try {
      const result = await action()
      if (isBrowserProfile(result)) replaceProfile(result)
      return result
    } catch (reason) {
      error.value = messageFor(reason)
      throw reason
    } finally {
      busyProfile.value = null
    }
  }

  function replaceProfile(updated: BrowserProfile): void {
    profiles.value = profiles.value.map((profile) => (profile.id === updated.id ? updated : profile))
  }

  function clearError(): void {
    error.value = null
  }

  onMounted(() => {
    void load()
    refreshTimer = setInterval(() => void load({ silent: true }), REFRESH_INTERVAL_MS)
  })

  onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = null
  })

  return {
    profiles: readonly(profiles),
    loading: readonly(loading),
    creating: readonly(creating),
    busyProfile: readonly(busyProfile),
    error: readonly(error),
    create,
    update,
    remove,
    start,
    stop,
    reload: () => load(),
    clearError,
  }
}

function getBrowserProfilesBridge(): NonNullable<Window['desktop']> {
  const desktop = window.desktop
  if (!desktop) throw new Error('浏览器档案仅可在桌面客户端中使用')
  if (
    desktop.apiVersion !== 3 ||
    typeof desktop.listBrowserProfiles !== 'function' ||
    typeof desktop.createBrowserProfile !== 'function' ||
    typeof desktop.updateBrowserProfile !== 'function' ||
    typeof desktop.deleteBrowserProfile !== 'function' ||
    typeof desktop.startBrowserProfile !== 'function' ||
    typeof desktop.stopBrowserProfile !== 'function'
  ) {
    throw new Error('桌面端接口版本过旧，请完全退出客户端后重新启动')
  }
  return desktop
}

function isBrowserProfile(value: unknown): value is BrowserProfile {
  return typeof value === 'object' && value !== null && 'id' in value && 'runtime' in value
}

function messageFor(reason: unknown): string {
  return reason instanceof Error ? reason.message : '浏览器档案操作失败'
}
