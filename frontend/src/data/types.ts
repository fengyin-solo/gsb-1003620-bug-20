/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  // pending/abnormal/archived 都是 status 的派生标志，只由统一口径补算，不再由页面或动作各自维护。
  pending: boolean
  abnormal: boolean
  archived?: boolean
  // 旧数据里状态超出模块登记范围时置为 true：原行保留可追溯，但隔离在活动台账、归档清单与各项统计之外。
  invalid?: boolean
  [field: string]: string | number | boolean | undefined
}

/** 由当前状态按统一阈值判定出的标准口径：归档 / 待处理 / 异常。 */
export type RowFlags = {
  pending: boolean
  abnormal: boolean
  archived: boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: {
    name: string
    created: number
    pending: number
    abnormal: number
    archived: number
  }[]
}
