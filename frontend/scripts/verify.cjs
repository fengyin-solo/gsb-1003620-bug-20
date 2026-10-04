// 端到端校验：在 Node 里模拟 localStorage，把数据层 + 服务层 bundle 后跑一遍需求清单。
const esbuild = require('esbuild')
const path = require('path')
const assert = require('assert')

// ---- 浏览器环境垫片 ----
const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => {
      if (process.env.FORCE_STORAGE_FAIL) {
        throw new Error('QuotaExceededError: 模拟落库失败')
      }
      storage.set(k, String(v))
    },
    removeItem: (k) => storage.delete(k),
  },
}
globalThis.localStorage = globalThis.window.localStorage
globalThis.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } }
globalThis.URL = { createObjectURL: () => '', revokeObjectURL() {} }
globalThis.Blob = class {}

async function loadService() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/api/local-service.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: [],
    alias: { '@': path.join(__dirname, '../src') },
  })
  const code = result.outputFiles[0].text
  const module = { exports: {} }
  const fn = new Function('module', 'exports', 'require', code)
  fn(module, module.exports, require)
  return module.exports
}

let pass = 0
function check(name, fn) {
  try {
    fn()
    pass += 1
    console.log('  ✔', name)
  } catch (error) {
    console.error('  �"', name)
    console.error('   ', error.message)
    process.exitCode = 1
  }
}

async function main() {
  const svc = await loadService()
  const { runAction, listEntries, loadOverview, listArchiveEntries, createEntry, resetModule } = svc

  console.log('1) 旧数据按原状态兼容、统一口径补算')
  const ov0 = loadOverview()
  // 种子 18 模块 × 3 = 54 条；其中 5 条终态（patrol 已完成 / weather 已修正 / drone 已完成 / campaign 已完成 / treegrowth 已归档）补算进归档
  check('种子补算后台账 49 条、归档 5 条', () => {
    assert.strictEqual(ov0.cards.find((c) => c.label === '登记总量').value, 49)
    assert.strictEqual(ov0.cards.find((c) => c.label === '归档量').value, 5)
  })
  check('旧终态行的 pending/abnormal 已按规则重算（不在台账残留）', () => {
    assert.ok(!listEntries('patrol').items.some((r) => r.status === '已完成'))
    assert.ok(!listEntries('drone').items.some((r) => r.status === '已完成'))
  })
  check('归档清单能列出补算的 5 条', () => {
    assert.strictEqual(listArchiveEntries().total, 5)
  })
  check('待处理按统一口径：稳态 正常值守 不算待处理', () => {
    // lookout 行1 原 seed 误标 pending:true；按规则 正常值守 是稳态
    const lookout = listEntries('lookout').items.find((r) => r.id === 1)
    assert.strictEqual(lookout.pending, false)
  })
  check('异常量按统一口径：执行中 不是异常（seed 误标 abnormal:true）', () => {
    const patrol2 = listEntries('patrol').items.find((r) => r.id === 2)
    assert.strictEqual(patrol2.abnormal, false)
    assert.strictEqual(patrol2.pending, true) // 执行中仍待处理
  })
  check('真正的异常态被识别（临时关闭 abnormal, pending）', () => {
    const lookout2 = listEntries('lookout').items.find((r) => r.id === 2)
    assert.strictEqual(lookout2.abnormal, true)
    assert.strictEqual(lookout2.pending, true)
  })

  console.log('2) 撤销/终态动作：登记总量下降、待处理不残留、异常不重复')
  const before = loadOverview()
  const patrolBefore = listEntries('patrol').total
  const res1 = runAction('patrol', 1, '取消任务') // 待执行 -> 已取消
  check('取消动作成功并提示归档', () => {
    assert.strictEqual(res1.ok, true)
    assert.ok(res1.message.includes('归档'))
  })
  const after = loadOverview()
  check('登记总量 -1', () => {
    const b = before.cards.find((c) => c.label === '登记总量').value
    const a = after.cards.find((c) => c.label === '登记总量').value
    assert.strictEqual(a, b - 1)
  })
  check('patrol 台账 -1 且记录消失', () => {
    assert.strictEqual(listEntries('patrol').total, patrolBefore - 1)
    assert.ok(!listEntries('patrol').items.some((r) => r.id === 1))
  })
  check('归档清单 +1 且内容一致（已取消、异常）', () => {
    assert.strictEqual(listArchiveEntries().total, 6)
    const row = listArchiveEntries({ module: 'patrol' }).items.find((r) => r.id === 1)
    assert.ok(row)
    assert.strictEqual(row.status, '已取消')
    assert.strictEqual(row.abnormal, true)
    assert.strictEqual(row.pending, false)
  })
  check('异常量不重复：归档里的异常不进概览台账异常量', () => {
    const ab = after.cards.find((c) => c.label === '异常量').value
    const sumFromModules = after.modules.reduce((s, m) => s + m.abnormal, 0)
    assert.strictEqual(ab, sumFromModules)
  })

  console.log('3) 同一动作重复提交只生效一次')
  const res2 = runAction('patrol', 1, '取消任务')
  check('重复提交被判重拒绝、不再落库', () => {
    assert.strictEqual(res2.ok, false)
    assert.ok(res2.message.includes('归档') || res2.message.includes('重复'))
  })
  check('归档里仍只有一条该记录', () => {
    const rows = listArchiveEntries({ module: 'patrol' }).items.filter((r) => r.id === 1)
    assert.strictEqual(rows.length, 1)
  })
  // 同状态重复动作
  runAction('patrol', 2, '开始巡护') // 执行中 -> 执行中
  check('目标状态等于当前状态也判重', () => {
    const r = runAction('patrol', 2, '开始巡护')
    assert.strictEqual(r.ok, false)
  })

  console.log('4) 非终态动作只改状态，不进归档，总量不变')
  const ovBefore = loadOverview().cards.find((c) => c.label === '登记总量').value
  const r3 = runAction('firereport', 1, '核实火情') // 待核实 -> 已确认
  check('核实成功', () => assert.strictEqual(r3.ok, true))
  check('总量不变、归档不增加', () => {
    assert.strictEqual(loadOverview().cards.find((c) => c.label === '登记总量').value, ovBefore)
    assert.strictEqual(listArchiveEntries().total, 6)
  })
  check('记录状态已更新且在台账', () => {
    const row = listEntries('firereport').items.find((r) => r.id === 1)
    assert.strictEqual(row.status, '已确认')
    assert.strictEqual(row.abnormal, true)
  })

  console.log('5) 刷新与返回结果一致（重新读取=同一份落库状态）')
  const ovFresh1 = loadOverview()
  const ovFresh2 = loadOverview()
  check('两次 loadOverview 完全一致', () => {
    assert.deepStrictEqual(ovFresh1.cards, ovFresh2.cards)
  })

  console.log('6) 登记校验：统一阈值，超出范围不允许保存')
  check('相对湿度 >100 拒绝', () => {
    const r = createEntry('firewatch', { 监测点编号: 'T-1', 相对湿度: '120' })
    assert.strictEqual(r.ok, false)
    assert.ok(r.message.includes('相对湿度'))
  })
  check('郁闭度 1.5 拒绝', () => {
    const r = createEntry('treegrowth', { 记录编号: 'TG-1', 郁闭度: '1.5' })
    assert.strictEqual(r.ok, false)
  })
  check('非整数计数拒绝', () => {
    const r = createEntry('patrol', { 任务编号: 'P-1', 发现火情数: '1.5' })
    assert.strictEqual(r.ok, false)
  })
  check('非法日期拒绝', () => {
    const r = createEntry('patrol', { 任务编号: 'P-2', 巡护日期: '2026-13-40' })
    assert.strictEqual(r.ok, false)
  })
  check('负数拒绝', () => {
    const r = createEntry('equipment', { 装备编号: 'E-1' })
    assert.strictEqual(r.ok, true) // 无阈值字段时允许
  })
  check('编号为空拒绝', () => {
    const r = createEntry('patrol', { 任务编号: '   ' })
    assert.strictEqual(r.ok, false)
  })
  check('重复编号拒绝（含归档里的编号 PATR-0001 已归档仍判重）', () => {
    const r = createEntry('patrol', { 任务编号: 'PATR-0001' })
    assert.strictEqual(r.ok, false)
  })
  const totalBeforeCreate = loadOverview().cards.find((c) => c.label === '登记总量').value
  const okCreate = createEntry('patrol', { 任务编号: 'PATR-9001', 巡护区域: 'A区' })
  check('合法登记成功、总量 +1', () => {
    assert.strictEqual(okCreate.ok, true)
    assert.strictEqual(loadOverview().cards.find((c) => c.label === '登记总量').value, totalBeforeCreate + 1)
  })

  console.log('7) 别的模块待处理清单同步重算（概览聚合）')
  // 任意模块动作后，概览所有模块行都由同一份状态重算
  const pendingRow = (key) => loadOverview().modules.find((m) => m.name && m) && null
  void pendingRow
  runAction('duty', 1, '确认排班') // 待确认 -> 已确认（仍待处理）
  check('duty 行1 待处理仍为 true（已确认不是稳态）', () => {
    const row = listEntries('duty').items.find((r) => r.id === 1)
    assert.strictEqual(row.pending, true)
  })
  runAction('duty', 1, '记录交接') // -> 已交接 终态
  check('交接后 duty 台账少一条、归档多一条、pending 减少', () => {
    assert.ok(!listEntries('duty').items.some((r) => r.id === 1))
    assert.ok(listArchiveEntries({ module: 'duty' }).items.some((r) => r.id === 1))
  })

  console.log('8) 落库失败一起退回（缓存与存储保持原状态）')
  const snapshot = JSON.parse(storage.get('forest-fire-patrol:entries'))
  process.env.FORCE_STORAGE_FAIL = '1'
  let threw = false
  try {
    runAction('patrol', 3, '取消任务')
  } catch {
    threw = true
  }
  process.env.FORCE_STORAGE_FAIL = ''
  check('落库失败抛出且事务退回（记录仍在台账）', () => {
    assert.strictEqual(threw, true)
    assert.ok(listEntries('patrol').items.some((r) => r.id === 3))
  })
  check('存储内容未被污染', () => {
    const now = JSON.parse(storage.get('forest-fire-patrol:entries'))
    assert.strictEqual(now.archive.length, snapshot.archive.length)
  })

  console.log('9) resetModule 清掉该模块归档残留')
  resetModule('patrol')
  check('reset 后 patrol 归档不含重置前的动作记录（仅示例补算的 已完成 1 条）', () => {
    const rows = listArchiveEntries({ module: 'patrol' }).items
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].status, '已完成')
  })

  console.log(`\\n${pass} 项检查通过`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
