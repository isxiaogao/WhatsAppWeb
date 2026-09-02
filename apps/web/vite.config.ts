import { fileURLToPath, URL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))
const srcRoot = fileURLToPath(new URL('./src', import.meta.url))

function loadExampleEnv(): Record<string, string> {
  const examplePath = resolve(workspaceRoot, '.env.example')
  if (!existsSync(examplePath)) return {}
  return Object.fromEntries(
    readFileSync(examplePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
}

function requiredEnv(env: Record<string, string>, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`Missing ${name}; copy .env.example to .env or keep it in .env.example`)
  return value
}

export default defineConfig(({ mode }) => {
  const env = { ...loadExampleEnv(), ...loadEnv(mode, workspaceRoot, '') }
  const webPort = Number(requiredEnv(env, 'WEB_PORT'))
  if (!Number.isInteger(webPort) || webPort <= 0) throw new Error('WEB_PORT must be a positive integer')

  return {
    plugins: [vue()],
    resolve: {
      alias: { '@': srcRoot },
    },
    server: {
      host: requiredEnv(env, 'WEB_HOST'),
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': { target: requiredEnv(env, 'CONTROL_API_PROXY_TARGET'), changeOrigin: true },
      },
    },
  }
})
