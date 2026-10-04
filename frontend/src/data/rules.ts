import { MODULE_BY_KEY, MODULES } from './modules'

// 统一口径：状态怎么判、字段取什么值，全系统只认这一份。
// 页面、模块台账、运营概览、归档清单都从这里取规则，避免各算各的导致三处数字对不上。

// 已结束、不再需要处理的状态（终态）。终态记录从模块台账移入归档清单。
const CLOSED_STATUS_BY_MODULE: Record<string, string[]> = {
  patrol: ['已完成', '已取消'],
  firewatch: [], // 监测点持续在役，没有终态
  lookout: [], // 故障/关闭都是在役期间的待处理异常，没有终态
  firebreak: ['已荒废'],
  fireteam: ['已撤回', '休整中'],
  equipment: ['已报废'],
  weather: ['已修正'],
  firereport: ['已扑灭', '误报'],
  drone: ['已完成', '因故中止'],
  campaign: ['已完成', '已取消'],
  checkpoint: [], // 站点持续运行，没有终态
  duty: ['已交接', '已调班'],
  supply: ['已过期'],
  forestroad: ['禁止通行'],
  firebelt: ['已退化'],
  drill: ['已总结', '已归档'],
  burnpermit: ['已批准', '已驳回', '已执行'],
  treegrowth: ['已归档'],
}

// 在役稳态：无需继续处理、但记录仍留在台账里的状态。
// 不在终态、又不在稳态里的状态，一律按「待处理」判定。
const STEADY_STATUS: string[] = [
  '正常',
  '正常值守',
  '在营待命',
  '可用',
  '已审核',
  '正常检查',
  '充足',
  '正常通行',
  '完好',
]

// 终态里同时属于异常的状态：撤销/取消/中止/误报/驳回/荒废这类，进了归档仍算异常量。
const ABNORMAL_CLOSED_BY_MODULE: Record<string, string[]> = {
  patrol: ['已取消'],
  firebreak: ['已荒废'],
  firereport: ['误报'],
  drone: ['因故中止'],
  campaign: ['已取消'],
  supply: ['已过期'],
  forestroad: ['禁止通行'],
  firebelt: ['已退化'],
  burnpermit: ['已驳回'],
}

// 标准异常状态（台账在役记录）：命中即记一笔异常量。
const ABNORMAL_STATUS: string[] = [
  '蓝色预警',
  '黄色预警',
  '橙色预警',
  '红色预警',
  '临时关闭',
  '设备故障',
  '维修中',
  '需割草',
  '需补植',
  '有缺株',
  '已出动',
  '扑救中',
  '已领用',
  '待检修',
  '异常值',
  '待核实',
  '已确认',
  '已出警',
  '飞行中',
  '进行中',
  '升级检查',
  '偏低',
  '需补充',
  '需维护',
  '正在施工',
  '需复核',
  '筹备中',
  '待审批',
]

export type StateKind = {
  pending: boolean
  abnormal: boolean
  closed: boolean
}

function normalizeModuleKey(key: string): string {
  return MODULE_BY_KEY.has(key) ? key : ''
}

export function closedStatuses(key: string): string[] {
  return CLOSED_STATUS_BY_MODULE[normalizeModuleKey(key)] ?? []
}

// 唯一的状态判定入口：概览、台账、归档、动作流转都调它。
export function classifyStatus(key: string, status: string): StateKind {
  const current = String(status ?? '')
  const closed = closedStatuses(key).includes(current)
  const abnormal = closed
    ? (ABNORMAL_CLOSED_BY_MODULE[normalizeModuleKey(key)] ?? []).includes(current)
    : ABNORMAL_STATUS.includes(current)
  // 终态和在役稳态都不用继续处理，其余状态（进行中/待审批/异常待处置等）都是待处理。
  const pending = !closed && !STEADY_STATUS.includes(current)
  return { pending, abnormal, closed }
}

export function isClosedStatus(key: string, status: string): boolean {
  return classifyStatus(key, status).closed
}

export function isPendingStatus(key: string, status: string): boolean {
  return classifyStatus(key, status).pending
}

export function isAbnormalStatus(key: string, status: string): boolean {
  return classifyStatus(key, status).abnormal
}

// ---- 字段取值的统一阈值与判定规则 -------------------------------------------

const DATE_FIELDS = [
  '巡护日期',
  '监测时间',
  '建成日期',
  '最近维护日期',
  '购入日期',
  '观测时间',
  '起火时间',
  '起飞时间',
  '降落时间',
  '活动日期',
  '值班日期',
  '最近巡检日',
  '演练日期',
  '计划时段',
]

// [最小值, 最大值, 字段说明]：登记/保存时超出范围一律拒绝。
const NUMERIC_RULES: Record<string, { min: number; max: number; label: string }> = {
  海拔高度: { min: 0, max: 8849, label: '海拔高度（0~8849 米）' },
  视野覆盖面积: { min: 0, max: 100000, label: '视野覆盖面积（0~100000 公顷）' },
  带宽米数: { min: 0, max: 500, label: '带宽米数（0~500 米）' },
  队员人数: { min: 0, max: 10000, label: '队员人数（0~10000 人）' },
  集结半径: { min: 0, max: 1000, label: '集结半径（0~1000 公里）' },
  相对湿度: { min: 0, max: 100, label: '相对湿度（0~100%）' },
  气温读数: { min: -50, max: 60, label: '气温读数（-50~60℃）' },
  气温: { min: -50, max: 60, label: '气温（-50~60℃）' },
  降水量: { min: 0, max: 2000, label: '降水量（0~2000 毫米）' },
  过火面积: { min: 0, max: 1000000, label: '过火面积（0~1000000 亩）' },
  发现异常数: { min: 0, max: 100000, label: '发现异常数（非负整数）' },
  发现火情数: { min: 0, max: 100000, label: '发现火情数（非负整数）' },
  受众人数: { min: 0, max: 1000000, label: '受众人数（非负整数）' },
  参演人数: { min: 0, max: 100000, label: '参演人数（非负整数）' },
  通行车辆数: { min: 0, max: 1000000, label: '通行车辆数（非负整数）' },
  收缴火种数: { min: 0, max: 1000000, label: '收缴火种数（非负整数）' },
  预警储备量: { min: 0, max: 100000000, label: '预警储备量（非负数）' },
  实际储备量: { min: 0, max: 100000000, label: '实际储备量（非负数）' },
  林带长度: { min: 0, max: 100000, label: '林带长度（0~100000 米）' },
  林带宽度: { min: 0, max: 10000, label: '林带宽度（0~10000 米）' },
  种植年份: { min: 1900, max: 2100, label: '种植年份（1900~2100）' },
  平均胸径: { min: 0, max: 1000, label: '平均胸径（0~1000 厘米）' },
  平均树高: { min: 0, max: 200, label: '平均树高（0~200 米）' },
  郁闭度: { min: 0, max: 1, label: '郁闭度（0~1）' },
}

// 允许小数的数值字段；其余计数字段必须是非负整数。
const DECIMAL_FIELDS = new Set([
  '海拔高度',
  '视野覆盖面积',
  '带宽米数',
  '集结半径',
  '相对湿度',
  '气温读数',
  '气温',
  '降水量',
  '过火面积',
  '预警储备量',
  '实际储备量',
  '林带长度',
  '林带宽度',
  '平均胸径',
  '平均树高',
  '郁闭度',
])

export type FieldKind = 'text' | 'date' | 'number'

export function fieldKind(field: string): FieldKind {
  if (DATE_FIELDS.includes(field)) {
    return 'date'
  }
  if (field in NUMERIC_RULES) {
    return 'number'
  }
  return 'text'
}

export function isDateField(field: string): boolean {
  return fieldKind(field) === 'date'
}

function isValidDateString(raw: string): boolean {
  const value = raw.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }
  const probe = new Date(year, month - 1, day)
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
}

export type FieldIssue = { field: string; message: string }

// 标准校验口径：返回所有越界/非法字段，调用方据此决定不允许保存。
export function validateValue(field: string, raw: unknown): string {
  if (raw === undefined || raw === null) {
    return ''
  }
  const value = String(raw).trim()
  if (value === '') {
    return ''
  }
  const kind = fieldKind(field)
  if (kind === 'date' && !isValidDateString(value)) {
    return `${field}必须是合法日期（YYYY-MM-DD）`
  }
  if (kind === 'number') {
    const rule = NUMERIC_RULES[field]
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return `${rule.label}必须是数字`
    }
    if (!DECIMAL_FIELDS.has(field) && !Number.isInteger(numeric)) {
      return `${field}必须是整数`
    }
    if (numeric < rule.min || numeric > rule.max) {
      return `${field}超出允许范围（${rule.label}）`
    }
  }
  if (value.length > 50) {
    return `${field}长度不能超过 50 个字符`
  }
  return ''
}

export function validateEntry(
  key: string,
  data: Record<string, unknown>,
): { ok: boolean; issues: FieldIssue[] } {
  const meta = MODULE_BY_KEY.get(key)
  const issues: FieldIssue[] = []
  if (!meta) {
    return { ok: false, issues: [{ field: '', message: `没有登记名为 ${key} 的业务模块` }] }
  }
  for (const field of meta.fields) {
    const message = validateValue(field, data[field])
    if (message) {
      issues.push({ field, message })
    }
  }
  return { ok: issues.length === 0, issues }
}

// 开发自检：每个模块配置的终态都必须是该模块登记过的合法状态，防止拼写漏配。
// 待处理是默认判定，未列入稳态/异常/终态的状态自动落入待处理，不需要逐条登记。
export function assertRuleCoverage(): void {
  for (const meta of MODULES) {
    for (const status of closedStatuses(meta.key)) {
      if (!meta.statuses.includes(status)) {
        throw new Error(`模块 ${meta.key} 的终态「${status}」不在其登记状态里`)
      }
    }
  }
}
