import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Account, Conversation, MediaAsset, Message } from './domain.js'

export interface ControlState {
  accounts: Account[]
  conversations: Conversation[]
  messages: Message[]
  mediaAssets: MediaAsset[]
}

export interface StateStore {
  load(): ControlState
  save(state: ControlState): void
}

const emptyState = (): ControlState => ({ accounts: [], conversations: [], messages: [], mediaAssets: [] })

export class JsonStateStore implements StateStore {
  private readonly filePath: string

  constructor(
    filePath = path.resolve(
      process.env.CONTROL_STATE_PATH ?? path.join(process.cwd(), 'runtime', 'control-center.json'),
    ),
  ) {
    this.filePath = filePath
  }

  load(): ControlState {
    if (!existsSync(this.filePath)) return emptyState()
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ControlState>
    return {
      accounts: parsed.accounts ?? [],
      conversations: parsed.conversations ?? [],
      messages: parsed.messages ?? [],
      mediaAssets: parsed.mediaAssets ?? [],
    }
  }

  save(state: ControlState): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf8')
      renameSync(temporaryPath, this.filePath)
    } finally {
      rmSync(temporaryPath, { force: true })
    }
  }
}

export class MemoryStateStore implements StateStore {
  private state = emptyState()

  load(): ControlState {
    return structuredClone(this.state)
  }

  save(state: ControlState): void {
    this.state = structuredClone(state)
  }
}
