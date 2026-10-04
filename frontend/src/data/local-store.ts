import { emitDataChange } from './events'
import { classifyStatus } from './rules'
import { SEED_ROWS } from './seed'
import type { ArchiveRow, EntryRow } from './types'

// 本地持久化：台账与归档清单同一次落库，刷新、关掉再打开都还在。
const STORAGE_KEY = 'forest-fire-patrol:entries'
const STORE_VERSION = 2

export type { ArchiveRow } from './types'

export type DataState = {
  version: number
  // 模块台账：只放未结束（在役）记录。
  entries: Record<string, EntryRow[]>
  // 归档清单：记录进入终态后整体从台账移到这里，同一条记录不会两边重复。
  archive: ArchiveRow[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 旧数据按原状态兼容：status 一个字不改，只按统一口径补算 pending/abnormal，
// 已经处于终态的残留记录移入归档清单。
function canonicalRow(key: string, row: EntryRow): EntryRow {
  const kind = classifyStatus(key, String(row.status))
  return { ...row, pending: kind.pending, abnormal: kind.abnormal }
}

function seedState(): DataState {
  return migrate({ version: 1, entries: clone(SEED_ROWS), archive: [] })
}

export function migrate(legacy: unknown): DataState {
  const source = (legacy ?? {}) as {
    version?: number
    entries?: Record<string, EntryRow[]>
    archive?: ArchiveRow[]
  }
  if (source.version === STORE_VERSION && source.entries && source.archive) {
    return {
      version: STORE_VERSION,
      entries: source.entries,
      archive: source.archive,
    }
  }
  // v1 只有台账（或直接是 key->rows 的旧结构），没有归档清单。
  const rawEntries: Record<string, EntryRow[]> =
    source.entries ?? (source.version === undefined ? (legacy as Record<string, EntryRow[]>) : {})
  const entries: Record<string, EntryRow[]> = {}
  const archive: ArchiveRow[] = []
  for (const [key, rows] of Object.entries(rawEntries)) {
    const kept: EntryRow[] = []
    for (const row of rows) {
      const fixed = canonicalRow(key, row)
      if (classifyStatus(key, String(fixed.status)).closed) {
        archive.push({
          ...fixed,
          归档模块: key,
          归档动作: '历史数据补算归档',
          归档时间: '',
        })
      } else {
        kept.push(fixed)
      }
    }
    entries[key] = kept
  }
  return { version: STORE_VERSION, entries, archive }
}

function readStorage(): DataState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const state = migrate(JSON.parse(raw) as unknown)
    persist(state)
    return state
  } catch {
    persist(fallback)
    return fallback
  }
}

// 同一次落库：台账与归档清单在一个 JSON 里一次写入。
function persist(state: DataState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

let cache: DataState | null = null

export function getState(): DataState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return getState().entries[key] ?? []
}

export function listArchive(): ArchiveRow[] {
  return getState().archive
}

// 唯一的写入口：先在内存里组装完整的下一版状态，再一次性持久化。
// 落库前按统一口径重算每条记录的 pending/abnormal，任何模块改台账，
// 它（以及归档清单）的待处理数都会同步重算。
// 持久化抛错（配额/隐私模式等）时缓存保持原样，概览和归档清单一起退回，绝不半落库。
export function commitState(produce: (draft: DataState) => void): DataState {
  const current = getState()
  const next: DataState = {
    version: STORE_VERSION,
    entries: clone(current.entries),
    archive: clone(current.archive),
  }
  produce(next)
  next.entries = Object.fromEntries(
    Object.entries(next.entries).map(([key, rows]) => [key, rows.map((row) => canonicalRow(key, row))]),
  )
  next.archive = next.archive.map(
    (row): ArchiveRow => {
      const fixed = canonicalRow(row.归档模块, row)
      return {
        ...fixed,
        归档模块: row.归档模块,
        归档动作: row.归档动作,
        归档时间: row.归档时间,
      }
    },
  )
  persist(next)
  cache = next
  emitDataChange()
  return next
}

export function resetRows(key: string): EntryRow[] {
  // 重置模块：台账回到示例数据；该模块此前归档出去的记录一并退回，避免清单残留。
  const seeded = clone(SEED_ROWS[key] ?? []).map((row) => canonicalRow(key, row))
  const kept: EntryRow[] = []
  const restored: ArchiveRow[] = []
  for (const row of seeded) {
    if (classifyStatus(key, String(row.status)).closed) {
      restored.push({
        ...row,
        归档模块: key,
        归档动作: '重置示例数据',
        归档时间: '',
      })
    } else {
      kept.push(row)
    }
  }
  commitState((draft) => {
    draft.entries[key] = kept
    draft.archive = [
      ...draft.archive.filter((item) => item.归档模块 !== key),
      ...restored,
    ]
  })
  return kept
}

export function storageKey(): string {
  return STORAGE_KEY
}
