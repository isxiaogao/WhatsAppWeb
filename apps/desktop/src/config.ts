import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface DesktopConfig {
  controlApiUrl: string
}

const DEFAULT_CONTROL_API_URL = 'http://127.0.0.1:4100'

export function normalizeControlApiUrl(value: string): string {
  const url = new URL(value.trim())
  const isLoopbackHttp =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    throw new Error('控制服务地址必须使用 HTTPS；仅本机服务允许 HTTP。')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('控制服务地址不能包含账号、查询参数或片段。')
  }
  return url.toString().replace(/\/$/, '')
}

export async function loadDesktopConfig(userDataDirectory: string): Promise<DesktopConfig> {
  const filePath = configPath(userDataDirectory)
  try {
    const content = await readFile(filePath, 'utf8')
    const stored = JSON.parse(content) as Partial<DesktopConfig>
    return { controlApiUrl: normalizeControlApiUrl(stored.controlApiUrl ?? DEFAULT_CONTROL_API_URL) }
  } catch {
    return { controlApiUrl: DEFAULT_CONTROL_API_URL }
  }
}

export async function saveDesktopConfig(
  userDataDirectory: string,
  input: DesktopConfig,
): Promise<DesktopConfig> {
  const config = { controlApiUrl: normalizeControlApiUrl(input.controlApiUrl) }
  const filePath = configPath(userDataDirectory)
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
  return config
}

function configPath(userDataDirectory: string): string {
  return path.join(userDataDirectory, 'desktop-config.json')
}
