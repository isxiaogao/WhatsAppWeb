import { contextBridge, ipcRenderer } from 'electron'

export interface DesktopRuntimeConfig {
  controlApiUrl: string
}

contextBridge.exposeInMainWorld('desktop', {
  getRuntimeConfig: (): Promise<DesktopRuntimeConfig> => ipcRenderer.invoke('desktop:config:get'),
  saveRuntimeConfig: (input: DesktopRuntimeConfig): Promise<DesktopRuntimeConfig> =>
    ipcRenderer.invoke('desktop:config:save', input),
  getVersion: (): Promise<string> => ipcRenderer.invoke('desktop:app:version'),
})
