import {
  commitState,
  getState,
  listArchive,
  listRows,
  resetRows,
} from '@/data/local-store'
import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import { classifyStatus, fieldKind, validateEntry } from '@/data/rules'
import type {
  ActionResult,
  ArchiveRow,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 列表读出来的记录，pending/abnormal 永远按统一口径现算，不相信行里存的旧标记。
function presentRow(key: string, row: EntryRow): EntryRow {
  const kind = classifyStatus(key, String(row.status))
  return { ...row, pending: kind.pending, abnormal: kind.abnormal }
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key).map((row) => presentRow(key, row)), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function listArchiveEntries(
  filters: { module?: string; keyword?: string } = {},
): { items: ArchiveRow[]; total: number } {
  let items = listArchive().map((row): ArchiveRow => {
    const kind = classifyStatus(row.归档模块, String(row.status))
    return { ...row, pending: kind.pending, abnormal: kind.abnormal }
  })
  if (filters.module) {
    items = items.filter((row) => row.归档模块 === filters.module)
  }
  const keyword = filters.keyword?.trim() ?? ''
  if (keyword) {
    items = items.filter((row) =>
      Object.entries(row).some(
        ([field, value]) => !field.startsWith('归档') && String(value).includes(keyword),
      ),
    )
  }
  return { items, total: items.length }
}

// 同一动作重复提交只生效一次：
// 1) 记录已处于该动作目标状态（或已归档离开台账）→ 直接判重，不再落库；
// 2) 台账移除 + 归档写入在同一次 commit 里完成，天然只产生一份归档。
export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const state = getState()
  const rows = state.entries[key] ?? []
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    // 台账里找不到：要么编号不存在，要么已经因上一次提交进了归档清单。
    const archived = state.archive.some(
      (row) => row.归档模块 === key && Number(row.id) === id,
    )
    return archived
      ? { ok: false, message: `${meta.entity}已归档，无需重复操作` }
      : { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  const kind = classifyStatus(key, target)
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: kind.pending,
    abnormal: kind.abnormal,
  }

  // 概览和归档清单同次落库：一次 commit 同时改台账与归档，失败一起退回。
  commitState((draft) => {
    const nextRows = [...(draft.entries[key] ?? [])]
    nextRows.splice(index, 1)
    if (kind.closed) {
      // 终态：从台账移除并整体进归档，登记总量随之下降、待处理不再残留、异常不重复计数。
      const archivedRow: ArchiveRow = {
        ...updated,
        归档模块: key,
        归档动作: action,
        归档时间: new Date().toISOString(),
      }
      draft.archive.push(archivedRow)
    } else {
      nextRows.splice(index, 0, updated)
    }
    draft.entries[key] = nextRows
  })

  return kind.closed
    ? { ok: true, message: `${meta.entity}已${action}，状态「${target}」，已移入归档清单` }
    : { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function createEntry(key: string, input: Record<string, unknown>): ActionResult {
  const meta = moduleMeta(key)
  const validation = validateEntry(key, input)
  if (!validation.ok) {
    return { ok: false, message: validation.issues.map((item) => item.message).join('；') }
  }
  const codeField = meta.fields[0]
  const code = String(input[codeField] ?? '').trim()
  if (!code) {
    return { ok: false, message: `${codeField}不能为空` }
  }
  const state = getState()
  const rows = state.entries[key] ?? []
  const duplicated =
    rows.some((row) => String(row[codeField] ?? '') === code) ||
    state.archive.some(
      (row) => row.归档模块 === key && String(row[codeField] ?? '') === code,
    )
  if (duplicated) {
    // 同一编号重复登记只保留第一笔，重复提交不产生新记录。
    return { ok: false, message: `${codeField}「${code}」已存在，不能重复登记` }
  }
  const nextId =
    rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const status = String(meta.statuses[0] ?? '')
  const kind = classifyStatus(key, status)
  const entry: EntryRow = {
    id: nextId,
    status,
    pending: kind.pending,
    abnormal: kind.abnormal,
  }
  for (const field of meta.fields) {
    const value = input[field]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      entry[field] = String(value).trim()
    }
  }
  commitState((draft) => {
    draft.entries[key] = [...(draft.entries[key] ?? []), entry]
  })
  return { ok: true, message: `${meta.entity}「${code}」登记成功` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 运营概览与模块台账共用同一份状态、同一套判定规则，刷新与返回结果必然一致。
export function loadOverview(): OverviewResult {
  const state = getState()
  const archiveCountByModule = new Map<string, number>()
  let archivedAbnormal = 0
  for (const row of state.archive) {
    archiveCountByModule.set(
      row.归档模块,
      (archiveCountByModule.get(row.归档模块) ?? 0) + 1,
    )
    if (classifyStatus(row.归档模块, String(row.status)).abnormal) {
      archivedAbnormal += 1
    }
  }
  const modules = MODULES.map((meta) => {
    const entries = (state.entries[meta.key] ?? []).map((row) => presentRow(meta.key, row))
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
      archived: archiveCountByModule.get(meta.key) ?? 0,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    {
      label: '归档量',
      value: modules.reduce((sum, item) => sum + item.archived, 0),
    },
  ]
  return { cards, modules, archivedAbnormal }
}

export { fieldKind }
