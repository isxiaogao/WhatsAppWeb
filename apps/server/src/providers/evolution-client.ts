export interface EvolutionClientOptions {
  baseUrl?: string
  apiKey?: string
  timeoutMs?: number
}

export class EvolutionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message)
  }
}

export class EvolutionClient {
  readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number

  constructor(options: EvolutionClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.EVOLUTION_API_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
    this.apiKey = options.apiKey ?? process.env.EVOLUTION_API_KEY ?? 'local-mvp-evolution-key'
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async health(): Promise<unknown> {
    return this.request('GET', '/')
  }

  async fetchInstances(): Promise<unknown> {
    return this.request('GET', '/instance/fetchInstances')
  }

  async createInstance(instanceName: string): Promise<unknown> {
    return this.request('POST', '/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    })
  }

  async connectInstance(instanceName: string): Promise<unknown> {
    return this.request('GET', `/instance/connect/${encodeURIComponent(instanceName)}`)
  }

  async connectionState(instanceName: string): Promise<unknown> {
    return this.request('GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`)
  }

  async setWebhook(
    instanceName: string,
    input: { url: string; secret: string },
  ): Promise<unknown> {
    return this.request('POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: {
        enabled: true,
        url: input.url,
        events: [
          'QRCODE_UPDATED',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'SEND_MESSAGE',
          'CONNECTION_UPDATE',
          'CHATS_UPSERT',
          'CHATS_UPDATE',
        ],
        headers: { 'x-control-webhook-secret': input.secret },
        base64: false,
      },
    })
  }

  async logoutInstance(instanceName: string): Promise<unknown> {
    return this.request('DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`)
  }

  async deleteInstance(instanceName: string): Promise<unknown> {
    return this.request('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`)
  }

  async sendText(instanceName: string, number: string, text: string): Promise<unknown> {
    try {
      return await this.request('POST', `/message/sendText/${encodeURIComponent(instanceName)}`, {
        number,
        text,
        delay: 400,
        linkPreview: true,
      })
    } catch (error) {
      // Older Evolution releases used a nested textMessage object.
      if (!(error instanceof EvolutionApiError) || error.status !== 400) throw error
      return this.request('POST', `/message/sendText/${encodeURIComponent(instanceName)}`, {
        number,
        textMessage: { text },
        delay: 400,
        linkPreview: true,
      })
    }
  }

  async sendMedia(
    instanceName: string,
    input: {
      number: string
      mediatype: 'image' | 'video'
      mimetype: string
      body: Buffer
      caption: string
      fileName: string
    },
  ): Promise<unknown> {
    const form = new FormData()
    form.set('number', input.number)
    form.set('mediatype', input.mediatype)
    form.set('mimetype', input.mimetype)
    form.set('caption', input.caption)
    form.set('fileName', input.fileName)
    form.set('filename', input.fileName)
    form.set(
      'file',
      new Blob([new Uint8Array(input.body)], { type: input.mimetype }),
      input.fileName,
    )
    return this.request(
      'POST',
      `/message/sendMedia/${encodeURIComponent(instanceName)}`,
      form,
      120_000,
    )
  }

  async updateProfilePicture(instanceName: string, picture: string): Promise<unknown> {
    return this.request(
      'POST',
      `/chat/updateProfilePicture/${encodeURIComponent(instanceName)}`,
      { picture },
      60_000,
    )
  }

  async removeProfilePicture(instanceName: string): Promise<unknown> {
    return this.request('DELETE', `/chat/removeProfilePicture/${encodeURIComponent(instanceName)}`)
  }

  async getBase64FromMediaMessage(instanceName: string, message: unknown): Promise<unknown> {
    return this.request(
      'POST',
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      { message },
      120_000,
    )
  }

  async findChats(instanceName: string): Promise<unknown> {
    return this.request('POST', `/chat/findChats/${encodeURIComponent(instanceName)}`, {
      where: {},
      take: 50,
      skip: 0,
      orderBy: { updatedAt: 'desc' },
    })
  }

  async findMessages(instanceName: string, remoteJid: string): Promise<unknown> {
    return this.request('POST', `/chat/findMessages/${encodeURIComponent(instanceName)}`, {
      where: { key: { remoteJid } },
      take: 50,
      skip: 0,
      orderBy: { messageTimestamp: 'desc' },
    })
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const isMultipart = body instanceof FormData
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          apikey: this.apiKey,
          Accept: 'application/json',
          ...(body === undefined || isMultipart ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: isMultipart ? body : JSON.stringify(body) }),
        signal: controller.signal,
      })
      const raw = await response.text()
      const payload = raw ? safeJson(raw) : null
      if (!response.ok) {
        const detail = errorDetail(payload) ?? response.statusText
        throw new EvolutionApiError(`Evolution API ${response.status}: ${detail}`, response.status, payload)
      }
      return payload
    } catch (error) {
      if (error instanceof EvolutionApiError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Evolution API 请求超时 (${this.baseUrl})`)
      }
      const detail = error instanceof Error ? error.message : '网络错误'
      throw new Error(`无法连接 Evolution API (${this.baseUrl}): ${detail}`)
    } finally {
      clearTimeout(timeout)
    }
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function errorDetail(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.slice(0, 300)
  if (!isRecord(payload)) return null
  const value = payload.message ?? payload.error ?? payload.response
  if (typeof value === 'string') return value
  return value === undefined ? null : JSON.stringify(value).slice(0, 300)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
