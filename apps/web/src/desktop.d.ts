export interface DesktopRuntimeConfig {
  controlApiUrl: string
}

declare global {
  interface Window {
    desktop?: {
      getRuntimeConfig(): Promise<DesktopRuntimeConfig>
      saveRuntimeConfig(input: DesktopRuntimeConfig): Promise<DesktopRuntimeConfig>
      getVersion(): Promise<string>
    }
  }
}

export {}
