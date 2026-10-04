import { flagsForStatus, isKnownStatus, MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

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

// 活动台账：只显示未归档、且状态有效的记录；终态（完成/异常）进归档清单，越界旧行隔离，均不在台账残留。
export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(
    listRows(key).filter((row) => !row.archived && !row.invalid),
    filters,
  )
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 归档清单：与活动台账互斥，同一份存储数据的另一面。
export function listArchive(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(
    listRows(key).filter((row) => row.archived && !row.invalid),
    filters,
  )
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 统一阈值：目标状态必须落在模块登记的状态域内，超出范围不允许保存。
  if (!isKnownStatus(meta, target)) {
    return { ok: false, message: `「${target}」不在${meta.name}登记的状态范围内，禁止落库` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id && !row.invalid)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  // 幂等：同一动作重复提交只生效一次。已经是目标状态时直接返回成功口径，不再落库、不产生第二条流水。
  if (current === target) {
    return { ok: true, message: `${meta.entity}已是「${target}」，操作已生效，无需重复提交` }
  }
  // 标志由统一口径从目标状态推导，动作名（撤销/作废/驳回…）本身不再决定异常。
  const updated: EntryRow = { ...rows[index], status: target, ...flagsForStatus(target) }
  const next = [...rows]
  next[index] = updated
  try {
    // 整快照单次提交：本模块台账、归档清单与概览同次落库；失败由存储层整体回滚，这里原样退回。
    saveRows(key, next)
  } catch {
    return { ok: false, message: `${meta.entity}「${action}」落库失败，已整体退回，数据未改动` }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态', '台账归属']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    const bucket = row.invalid ? '隔离(越界旧数据)' : row.archived ? '归档清单' : '活动台账'
    lines.push(
      [
        row.id,
        ...meta.fields.map((field) => row[field] ?? ''),
        row.status,
        bucket,
      ].join(','),
    )
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

// 概览与各模块台账走同一份规范化数据：登记总量只数活动台账，异常量只数归档清单里的负向终态，互不重复。
export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    const valid = entries.filter((row) => !row.invalid)
    const active = valid.filter((row) => !row.archived)
    return {
      name: meta.name,
      created: active.length,
      pending: active.filter((row) => row.pending).length,
      abnormal: valid.filter((row) => row.archived && row.abnormal).length,
      archived: valid.filter((row) => row.archived).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '已归档', value: modules.reduce((sum, item) => sum + item.archived, 0) },
  ]
  return { cards, modules }
}
