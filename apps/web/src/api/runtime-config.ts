import type { Account, ControlEvent, Message } from '@/types'

let controlApiBaseUrl = ''

export const isDesktopRuntime = Boolean(window.desktop)

export async function initializeControlApi(): Promise<void> {
  if (!window.desktop) return
  const config = await window.desktop.getRuntimeConfig()
  controlApiBaseUrl = normalizeApiBaseUrl(config.controlApiUrl)
}

export function controlApiUrl(path: string): string {
  if (!controlApiBaseUrl) return path
  return new URL(path.replace(/^\//, ''), `${controlApiBaseUrl}/`).toString()
}

export function currentControlApiUrl(): string {
  return controlApiBaseUrl || window.location.origin
}

export async function saveControlApiUrl(value: string): Promise<void> {
  if (!window.desktop) throw new Error('仅桌面端支持修改控制服务地址。')
  const config = await window.desktop.saveRuntimeConfig({ controlApiUrl: value })
  controlApiBaseUrl = normalizeApiBaseUrl(config.controlApiUrl)
}

export function normalizeAccountUrls(account: Account): Account {
  return {
    ...account,
    avatarUrl: account.avatarUrl ? controlApiUrl(account.avatarUrl) : null,
  }
}

export function normalizeMessageUrls(message: Message): Message {
  if (!message.media) return message
  return {
    ...message,
    media: { ...message.media, url: controlApiUrl(message.media.url) },
  }
}

export function normalizeControlEventUrls(event: ControlEvent): ControlEvent {
  if (event.type === 'account.updated') {
    return { ...event, data: normalizeAccountUrls(event.data) }
  }
  if (event.type === 'message.created' || event.type === 'message.updated') {
    return { ...event, data: normalizeMessageUrls(event.data) }
  }
  return event
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value)
  return url.toString().replace(/\/$/, '')
}
