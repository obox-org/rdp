/**
 * 「打开」的静默去重（`src/dedup.js`）。
 *
 * 用户裁定：卡片上的状态提示**全部移除**（连右上角状态点、"点开看错误原文"展开区一起删），
 * 因此"打开中禁用"这个挡板没有了；替代品是"同一卡片 1 秒内的重复点击直接忽略，界面不出现
 * 任何变化"。本文件钉住那条时间窗的边界（替代方案"在飞请求未回前忽略"需要状态，与裁定相冲）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOpenDedup } from '../src/dedup.js'

/** 可控时钟：`clock.t` 是当前毫秒 */
function makeClock(start = 0) {
  const clock = { t: start }
  return Object.assign(clock, { now: () => clock.t })
}

test('首次点击放行；窗口内重复点击一律忽略（界面不出现任何变化）', () => {
  const clock = makeClock()
  const dedup = createOpenDedup({ now: clock.now })

  assert.equal(dedup.shouldIgnore(1), false, '第一次必须放行')
  clock.t = 1
  assert.equal(dedup.shouldIgnore(1), true, '1ms 后重按：忽略（双击）')
  clock.t = 999
  assert.equal(dedup.shouldIgnore(1), true, '999ms：仍在 1 秒窗口内')
})

test('边界：恰好 1000ms ⇒ 放行（窗口是"内"不含端点），1001ms 自然也放行', () => {
  const clock = makeClock()
  const dedup = createOpenDedup({ now: clock.now })

  assert.equal(dedup.shouldIgnore(1), false)
  clock.t = 1000
  assert.equal(dedup.shouldIgnore(1), false, '距离上次放行满 1 秒 ⇒ 这是新的一次点击')
  clock.t = 1000
  assert.equal(dedup.shouldIgnore(1), true, '新一轮窗口从这次放行时刻起算')
  clock.t = 2001
  assert.equal(dedup.shouldIgnore(1), false)
})

test('窗口按卡片独立：A 的点击不影响 B', () => {
  const clock = makeClock()
  const dedup = createOpenDedup({ now: clock.now })

  assert.equal(dedup.shouldIgnore(1), false)
  assert.equal(dedup.shouldIgnore(2), false, '另一张卡片的第一次点击必须放行')
  assert.equal(dedup.shouldIgnore(1), true)
  assert.equal(dedup.shouldIgnore('1'), true, '数字/字符串 id 视为同一张卡片（键统一字符串化）')
  assert.equal(dedup.shouldIgnore(3), false)
})

test('一次点击无论成败都占用窗口（失败后 1s 内的重试也会被吞）', () => {
  const clock = makeClock()
  const dedup = createOpenDedup({ now: clock.now })
  // 这里不模拟"失败"——模块刻意不区分成败（没有成功/失败回调），失败的重试同样被窗口挡住。
  assert.equal(dedup.shouldIgnore(1), false)
  clock.t = 300
  assert.equal(dedup.shouldIgnore(1), true)
})

test('窗口不跟随 IPC 时长：超过 1 秒的慢请求，第二次点击会被放行', () => {
  const clock = makeClock()
  const dedup = createOpenDedup({ now: clock.now })
  assert.equal(dedup.shouldIgnore(1), false)
  clock.t = 1500 // 第一次 cmdkey/派发还没回来（这是 `src/dedup.js` 文件头记下的已知代价）
  assert.equal(dedup.shouldIgnore(1), false)
})

test('自定义 windowMs 生效（含 0 = 不去重）', () => {
  const clock = makeClock()
  const dedup = createOpenDedup({ windowMs: 5000, now: clock.now })
  assert.equal(dedup.shouldIgnore(1), false)
  clock.t = 4999
  assert.equal(dedup.shouldIgnore(1), true)

  const off = createOpenDedup({ windowMs: 0, now: makeClock().now })
  assert.equal(off.shouldIgnore(1), false)
  assert.equal(off.shouldIgnore(1), false, 'windowMs=0 ⇒ 永不忽略')
})

test('forget / clear：删除连接后不再挡住同 id 的新点击；卸载时清空', () => {
  const clock = makeClock()
  const dedup = createOpenDedup({ now: clock.now })

  assert.equal(dedup.shouldIgnore(7), false)
  assert.equal(dedup.shouldIgnore(7), true)
  dedup.forget(7)
  clock.t = 500
  assert.equal(dedup.shouldIgnore(7), false, 'forget 之后立刻可再开一次')

  assert.equal(dedup.shouldIgnore(8), false)
  dedup.clear()
  assert.equal(dedup.shouldIgnore(8), false, 'clear 清掉所有窗口')
})

test('时钟回拨不锁死：now 变小当作新的基准时间，不误吞后续点击', () => {
  const clock = makeClock(10_000)
  const dedup = createOpenDedup({ now: clock.now })

  assert.equal(dedup.shouldIgnore(1), false)
  clock.t = 9_000 // 系统时钟被往回拨
  assert.equal(dedup.shouldIgnore(1), false, '回拨后这次放行（并成为新基准）')
  clock.t = 9_100
  assert.equal(dedup.shouldIgnore(1), true)
})

test('缺省参数可用：不传 options 时也用 Date.now / 1000ms', () => {
  const dedup = createOpenDedup()
  assert.equal(dedup.shouldIgnore(1), false)
  assert.equal(dedup.shouldIgnore(1), true)
  assert.equal(typeof dedup.forget, 'function')
  assert.equal(typeof dedup.clear, 'function')
})
