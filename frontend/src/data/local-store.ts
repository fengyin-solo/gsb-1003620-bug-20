import { MODULE_BY_KEY, flagsForStatus } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'forest-fire-patrol:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 所有模块的待处理清单共用这一次规范化：标志一律由当前状态按统一口径补算，
// 旧数据保留原 status，只是把历史写死、已经漂掉的 pending/abnormal/archived 修正回来。
function normalizeRow(key: string, row: EntryRow): EntryRow {
  const meta = MODULE_BY_KEY.get(key)
  const status = String(row.status ?? '')
  // 状态超出模块登记范围的旧脏数据：原行保留可追溯，标记 invalid 隔离起来 ——
  // 不进活动台账、不进归档清单、也不计数任何标准口径；新动作落到越界状态则在服务层直接拒保。
  if (!meta || !meta.statuses.includes(status)) {
    return { ...row, archived: false, pending: false, abnormal: false, invalid: true }
  }
  const { archived, pending, abnormal } = flagsForStatus(status)
  return { ...row, archived, pending, abnormal, invalid: false }
}

// 规范化是按全量快照做的：一次动作提交后，所有模块的待处理清单一起重算，概览与台账不会再各算各的。
function normalizeSnapshot(
  snapshot: Record<string, EntryRow[]>,
): { data: Record<string, EntryRow[]>; changed: boolean } {
  const data: Record<string, EntryRow[]> = {}
  let changed = false
  for (const [key, rows] of Object.entries(snapshot)) {
    const list = Array.isArray(rows) ? rows : []
    data[key] = list.map((row) => {
      const normalized = normalizeRow(key, row)
      if (
        normalized.pending !== Boolean(row.pending) ||
        normalized.abnormal !== Boolean(row.abnormal) ||
        Boolean(normalized.archived) !== Boolean(row.archived) ||
        Boolean(normalized.invalid) !== Boolean(row.invalid)
      ) {
        changed = true
      }
      return normalized
    })
  }
  return { data, changed }
}

function writeStorage(snapshot: Record<string, EntryRow[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}

function readRaw(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(SEED_ROWS)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return clone(SEED_ROWS)
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...clone(SEED_ROWS), ...parsed }
  } catch {
    return clone(SEED_ROWS)
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    const { data, changed } = normalizeSnapshot(readRaw())
    cache = data
    // 旧数据按原状态补算后同次落库；写不进去也不阻断页面，仅本次会话内保持一致（刷新会再补算一次）。
    if (changed && typeof window !== 'undefined' && window.localStorage) {
      try {
        writeStorage(data)
      } catch {
        /* 落库失败保持内存里的规范化结果，概览与台账本次仍一致 */
      }
    }
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/**
 * 整快照单次落库（概览、活动台账与归档清单是同一份数据、同一次提交）。
 * 提交前先按统一口径规范化全部模块；落库环节抛错都不替换缓存、不写半截数据 —— 失败一起退回。
 */
export function commitSnapshot(next: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const previous = allRows()
  const { data } = normalizeSnapshot(next)
  try {
    writeStorage(data)
  } catch (error) {
    // 回滚：缓存维持提交前的快照，内存与已落库内容保持一致。
    cache = previous
    throw error
  }
  cache = data
  return data
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitSnapshot({ ...allRows(), [key]: rows })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
