import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'node:stream'
import type { MediaKind } from './domain.js'

export interface StoreMediaInput {
  id: string
  accountId: string
  kind: MediaKind
  fileName: string
  mimeType: string
  body: Buffer
}

export interface StoredMediaObject {
  body: Readable
  contentLength: number | null
  contentRange: string | null
  contentType: string
}

export interface MediaStorage {
  put(input: StoreMediaInput): Promise<string>
  get(storageKey: string, range?: string): Promise<StoredMediaObject>
  createDownloadUrl(storageKey: string): Promise<string>
  delete(storageKey: string): Promise<void>
}

interface S3MediaStorageOptions {
  endpoint?: string
  region?: string
  bucket?: string
  accessKey?: string
  secretKey?: string
}

export class S3MediaStorage implements MediaStorage {
  private readonly bucket: string
  private readonly client: S3Client
  private ready: Promise<void> | null = null

  constructor(options: S3MediaStorageOptions = {}) {
    const region = options.region ?? process.env.MEDIA_S3_REGION ?? 'us-east-1'
    const endpoint = options.endpoint ?? process.env.MEDIA_S3_ENDPOINT ?? 'http://127.0.0.1:9000'
    const credentials = {
      accessKeyId: options.accessKey ?? process.env.MEDIA_S3_ACCESS_KEY ?? 'wa-control-media',
      secretAccessKey:
        options.secretKey ?? process.env.MEDIA_S3_SECRET_KEY ?? 'local-mvp-media-secret',
    }
    this.bucket = options.bucket ?? process.env.MEDIA_S3_BUCKET ?? 'wa-control-media'
    this.client = new S3Client({ region, endpoint, credentials, forcePathStyle: true })
  }

  async put(input: StoreMediaInput): Promise<string> {
    await this.ensureBucket()
    const storageKey = `${safeSegment(input.accountId)}/${input.kind.toLowerCase()}/${input.id}-${safeFileName(input.fileName)}`
    const upload = new Upload({
      client: this.client,
      leavePartsOnError: false,
      params: {
        Bucket: this.bucket,
        Key: storageKey,
        Body: input.body,
        ContentLength: input.body.byteLength,
        ContentType: input.mimeType,
        ContentDisposition: `inline; filename="${asciiFileName(input.fileName)}"`,
      },
    })
    await upload.done()
    return storageKey
  }

  async get(storageKey: string, range?: string): Promise<StoredMediaObject> {
    await this.ensureBucket()
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        ...(range ? { Range: range } : {}),
      }),
    )
    if (!(response.Body instanceof Readable)) throw new Error('媒体存储返回了不可读取的数据流')
    return {
      body: response.Body,
      contentLength: response.ContentLength ?? null,
      contentRange: response.ContentRange ?? null,
      contentType: response.ContentType ?? 'application/octet-stream',
    }
  }

  async createDownloadUrl(storageKey: string): Promise<string> {
    await this.ensureBucket()
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
      { expiresIn: 15 * 60 },
    )
  }

  async delete(storageKey: string): Promise<void> {
    await this.ensureBucket()
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }))
  }

  private ensureBucket(): Promise<void> {
    this.ready ??= this.prepareBucket().catch((error: unknown) => {
      this.ready = null
      throw error
    })
    return this.ready
  }

  private async prepareBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
    } catch (error) {
      if (!isMissingBucket(error)) throw error
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }))
    }
  }
}

export class MemoryMediaStorage implements MediaStorage {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>()

  async put(input: StoreMediaInput): Promise<string> {
    const storageKey = `${input.accountId}/${input.id}-${safeFileName(input.fileName)}`
    this.objects.set(storageKey, { body: Buffer.from(input.body), contentType: input.mimeType })
    return storageKey
  }

  async get(storageKey: string): Promise<StoredMediaObject> {
    const object = this.objects.get(storageKey)
    if (!object) throw new Error('媒体不存在')
    return {
      body: Readable.from(object.body),
      contentLength: object.body.byteLength,
      contentRange: null,
      contentType: object.contentType,
    }
  }

  async createDownloadUrl(storageKey: string): Promise<string> {
    return `https://media.test/${encodeURIComponent(storageKey)}`
  }

  async delete(storageKey: string): Promise<void> {
    this.objects.delete(storageKey)
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '')
}

function safeFileName(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return (normalized || 'media').slice(-120)
}

function asciiFileName(value: string): string {
  const ascii = safeFileName(value).replace(/[^a-zA-Z0-9._-]/g, '_')
  return ascii || 'media'
}

function isMissingBucket(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return candidate.name === 'NotFound' || candidate.name === 'NoSuchBucket' || candidate.$metadata?.httpStatusCode === 404
}
