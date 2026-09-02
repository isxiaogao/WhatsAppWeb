import { BrowserProfileStore, type BrowserProfile, type BrowserProfileInput } from './browser-profile-store.js'
import { ChromiumRuntime, type BrowserRuntimeSnapshot, type BrowserRuntimeStatus } from './chromium-runtime.js'

export interface ManagedBrowserProfile extends BrowserProfile {
  runtime: BrowserRuntimeSnapshot
}

export class BrowserProfileManager {
  constructor(
    private readonly store: BrowserProfileStore,
    private readonly runtime: ChromiumRuntime,
  ) {}

  async list(): Promise<ManagedBrowserProfile[]> {
    const profiles = await this.store.list()
    return profiles.map((profile) => this.withRuntime(profile))
  }

  async create(input: BrowserProfileInput): Promise<ManagedBrowserProfile> {
    return this.withRuntime(await this.store.create(input))
  }

  async update(profileId: string, input: BrowserProfileInput): Promise<ManagedBrowserProfile> {
    this.assertStopped(profileId, '编辑')
    return this.withRuntime(await this.store.update(profileId, input))
  }

  async delete(profileId: string): Promise<void> {
    const status = this.runtime.status(profileId).status
    if (status !== 'STOPPED') await this.runtime.stop(profileId)
    await this.store.delete(profileId)
  }

  async start(profileId: string): Promise<ManagedBrowserProfile> {
    const profile = await this.store.runtimeProfile(profileId)
    await this.runtime.start(profile, this.store.profileDataDirectory(profileId))
    return this.withRuntime(await this.store.markOpened(profileId))
  }

  async stop(profileId: string): Promise<ManagedBrowserProfile> {
    await this.runtime.stop(profileId)
    const profile = (await this.store.list()).find((item) => item.id === profileId)
    if (!profile) throw new Error('浏览器档案不存在')
    return this.withRuntime(profile)
  }

  status(profileId: string): BrowserRuntimeSnapshot {
    return this.runtime.status(profileId)
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown()
  }

  private withRuntime(profile: BrowserProfile): ManagedBrowserProfile {
    return { ...profile, runtime: this.runtime.status(profile.id) }
  }

  private assertStopped(profileId: string, operation: string): void {
    const status: BrowserRuntimeStatus = this.runtime.status(profileId).status
    if (status !== 'STOPPED' && status !== 'CRASHED') {
      throw new Error(`请先关闭浏览器档案后再${operation}`)
    }
  }
}
