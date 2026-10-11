/**
 * `src/theme.js`（子窗口主题接收桥）的单测：设计 §7.1 的 8 个用例。
 *
 * 全部用**假 window / 假 root**（可注入），不需要 DOM：
 *   - 假 root 的 `style.setProperty` 把值记进一个对象，便于断言"兜底 → 推送覆盖"；
 *   - 假 window 收集 `addEventListener`/`removeEventListener`、用可手动触发的定时器，
 *     使"0/300/1000 ms 三次请求 + 收到即停"可**确定性地**验证。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FALLBACK_TOKENS,
  applyThemeTokens,
  colorSchemeForThemeId,
  installThemeBridge,
  isTokenName,
  sanitizeThemeTokens
} from '../src/theme.js'

/** 造一套假环境：假 window + 假 parent（记录 postMessage）+ 假 documentElement */
function makeEnv() {
  const parent = {
    messages: [],
    postMessage(message) {
      this.messages.push(message)
    }
  }
  const root = {
    style: {
      values: {},
      setProperty(name, value) {
        this.values[name] = value
      }
    }
  }
  const win = {
    parent,
    document: { documentElement: root },
    listeners: [],
    timers: [],
    addEventListener(type, handler) {
      this.listeners.push({ type, handler })
    },
    removeEventListener(type, handler) {
      this.listeners = this.listeners.filter((item) => item.handler !== handler)
    },
    setTimeout(fn, ms) {
      const timer = { fn, ms, cleared: false }
      this.timers.push(timer)
      return timer
    },
    /** 被 clearTimeout 过的定时器（L4 的记账断言用：只该取消"还没触发的"） */
    cancelled: [],
    clearTimeout(timer) {
      if (!timer) return
      timer.cleared = true
      this.cancelled.push(timer)
    }
  }
  return {
    win,
    parent,
    root,
    /** 触发 window 上的 message 监听器 */
    dispatch(data, source = parent) {
      for (const item of [...win.listeners]) item.handler({ source, data })
    },
    /** 手工跑掉所有未被 clear 的定时器（按注册顺序） */
    runTimers() {
      for (const timer of [...win.timers]) if (!timer.cleared) timer.fn()
    },
    /** 收集 console.warn 的调用参数并静音，返回收集数组 */
    captureWarn(run) {
      const calls = []
      const original = console.warn
      console.warn = (...args) => calls.push(args)
      try {
        run()
      } finally {
        console.warn = original
      }
      return calls
    },
    /** 收集 console.log 的调用参数并静音，返回收集数组 */
    captureLog(run) {
      const calls = []
      const original = console.log
      console.log = (...args) => calls.push(args)
      try {
        run()
      } finally {
        console.log = original
      }
      return calls
    }
  }
}

const PUSH = (themeId, tokens) => ({
  source: 'obox-app',
  action: 'obox-theme',
  themeId,
  tokens
})

test('installThemeBridge 启动即写兜底 token（假 root 记录 setProperty）', () => {
  const env = makeEnv()
  installThemeBridge({ window: env.win, root: env.root })
  assert.deepEqual(env.root.style.values, FALLBACK_TOKENS)
  assert.equal(env.root.style.colorScheme, 'dark')
  assert.equal(Object.keys(env.root.style.values).length, 25)
})

test('N1：兜底 token 是"挂载前同步写满"的（输入类控件的关键 token 逐条有值）', () => {
  const env = makeEnv()
  // 不跑任何定时器、也不投递任何推送 ⇒ 模拟"宿主还没重启/推送没到"的仅兜底状态
  installThemeBridge({ window: env.win, root: env.root })
  const written = env.root.style.values
  const controlTokens = ['--bg', '--bg-panel', '--bg-input', '--border', '--fg', '--fg-dim']
  for (const name of controlTokens) {
    assert.equal(written[name], FALLBACK_TOKENS[name], `${name} 必须在首帧前就有值`)
    assert.ok(String(written[name]).trim() !== '', `${name} 不得是空值（var() 会求值成空）`)
  }
  // 输入框"四个面"齐全：底 / 字 / 边 / placeholder（N1 的可读性前提）
  assert.deepEqual(
    Object.keys(written).sort(),
    Object.keys(FALLBACK_TOKENS).sort(),
    '兜底必须一次写满 25 条，不能只写一部分'
  )
})

test('收到 obox-theme 推送后 token 生效并覆盖兜底值', () => {
  const env = makeEnv()
  installThemeBridge({ window: env.win, root: env.root })
  const logs = env.captureLog(() => {
    env.dispatch(PUSH('theme-light', { '--bg': '#ffffff', '--fg': '#000000' }))
  })
  assert.equal(env.root.style.values['--bg'], '#ffffff')
  assert.equal(env.root.style.values['--fg'], '#000000')
  // 未下发的 token 保留兜底值（不会被清空 ⇒ 不出现"无值"）
  assert.equal(env.root.style.values['--accent'], FALLBACK_TOKENS['--accent'])
  assert.equal(env.root.style.colorScheme, 'light')
  assert.equal(logs.length, 1)
  assert.match(String(logs[0][0]), /\[rdp\] 主题已应用 theme-light/)
})

test('推送里的非法键名 / 空值 / 非字符串被丢弃且不抛错', () => {
  const env = makeEnv()
  installThemeBridge({ window: env.win, root: env.root })
  const warns = env.captureWarn(() =>
    env.captureLog(() =>
      env.dispatch(
        PUSH('theme-dark', { '--bg': '#123456', bg: 'x', '--x': 1, '--y': '', '--z': null })
      )
    )
  )
  assert.equal(env.root.style.values['--bg'], '#123456')
  for (const bad of ['bg', '--x', '--y', '--z']) assert.equal(bad in env.root.style.values, false)
  assert.equal(warns.length, 1, '丢弃条目应汇总成一条 warn，而不是逐条刷屏')
  // 纯函数层面的同一口径
  assert.deepEqual(
    sanitizeThemeTokens({ '--bg': '#fff', bg: 'x', '--x': 1, '--y': '', '--z': null }),
    {
      '--bg': '#fff'
    }
  )
  assert.equal(isTokenName('--bg-panel'), true)
  assert.equal(isTokenName('bg'), false)
  assert.equal(isTokenName('--BG'), false)
  assert.equal(applyThemeTokens(undefined, env.root), 0)
})

test('收到推送后不再重发 obox-theme-request（请求最多 3 次）', () => {
  const env = makeEnv()
  const requests = () => env.parent.messages.map((message) => message.action)
  // ① 没有推送时：跑完定时器 → 恰好 3 次请求
  installThemeBridge({ window: env.win, root: env.root })
  env.captureWarn(() => env.runTimers())
  assert.deepEqual(requests(), ['obox-theme-request', 'obox-theme-request', 'obox-theme-request'])
  assert.deepEqual(env.parent.messages[0], { source: 'obox-app', action: 'obox-theme-request' })
  assert.equal(
    'requestId' in env.parent.messages[0],
    false,
    '主题请求是"通知 + 重发"，不带 requestId'
  )

  // ② 收到推送后：定时器被清掉，不再有任何请求
  const env2 = makeEnv()
  installThemeBridge({ window: env2.win, root: env2.root })
  env2.dispatch(PUSH('theme-dark', { '--bg': '#111111' }))
  env2.captureLog(() => env2.runTimers())
  assert.deepEqual(env2.parent.messages, [])
  assert.equal(env2.root.style.values['--bg'], '#111111', '推送不会被后来的兜底/请求覆盖')
})

test('3 次请求均无响应 → 保留兜底并打印一次 warn', () => {
  const env = makeEnv()
  installThemeBridge({ window: env.win, root: env.root })
  const warns = env.captureWarn(() => env.runTimers())
  assert.equal(warns.length, 1)
  assert.match(String(warns[0][0]), /未收到宿主主题推送/)
  assert.deepEqual(env.root.style.values, FALLBACK_TOKENS, '兜底值必须还在')
})

test('来源不是 parent 的消息被忽略', () => {
  const env = makeEnv()
  installThemeBridge({ window: env.win, root: env.root })
  const outsider = { messages: [], postMessage() {} }
  env.captureLog(() => {
    env.dispatch(PUSH('theme-light', { '--bg': '#ffffff' }), outsider)
    // 形状不对的消息（action 不符 / 非对象）也不影响
    env.dispatch({ source: 'obox-app', action: 'obox-extension-reply' })
    env.dispatch(null)
  })
  assert.equal(env.root.style.values['--bg'], FALLBACK_TOKENS['--bg'])
  assert.equal(env.root.style.colorScheme, 'dark')
  assert.equal(env.root.style.values['--bg'], FALLBACK_TOKENS['--bg'])
})

test('colorSchemeForThemeId：含 light 的 id → light，其余 → dark', () => {
  assert.equal(colorSchemeForThemeId('theme-light'), 'light')
  assert.equal(colorSchemeForThemeId('Light'), 'light')
  assert.equal(colorSchemeForThemeId('my-LIGHT-theme'), 'light')
  assert.equal(colorSchemeForThemeId('theme-dark'), 'dark')
  assert.equal(colorSchemeForThemeId(''), 'dark')
  assert.equal(colorSchemeForThemeId(undefined), 'dark')
})

test('无 window 环境（node）下 installThemeBridge 安全空转不抛错', () => {
  assert.equal(typeof window, 'undefined', '这个用例只在"没有全局 window"的环境里才有意义')
  const bridge = installThemeBridge()
  assert.equal(typeof bridge.dispose, 'function')
  bridge.dispose()
  // 显式给一个空 window 时也要安全空转（没有 documentElement 不写、不抛）
  const env = makeEnv()
  const stub = installThemeBridge({ window: env.win, root: undefined })
  stub.dispose()
  assert.deepEqual(env.parent.messages, [], '没有 root 时不应开始请求')
})

test('dispose 之后不再响应推送 / 不再请求', () => {
  const env = makeEnv()
  const bridge = installThemeBridge({ window: env.win, root: env.root })
  bridge.dispose()
  env.dispatch(PUSH('theme-light', { '--bg': '#ffffff' }))
  env.captureWarn(() => env.runTimers())
  assert.equal(env.root.style.values['--bg'], FALLBACK_TOKENS['--bg'])
  assert.deepEqual(env.parent.messages, [])
})

test('L4：clearTimers 的记账——只取消"还没触发"的定时器，已触发的不再重复取消', () => {
  // ① 三个请求定时器都跑过之后再 dispose：不应再对它们调用 clearTimeout
  const env = makeEnv()
  const bridge = installThemeBridge({ window: env.win, root: env.root })
  env.captureWarn(() => env.runTimers())
  assert.equal(env.parent.messages.length, 3, '三个请求都已发出')
  const afterRun = env.win.cancelled.length
  assert.equal(afterRun, 0, '触发阶段不该取消任何定时器')
  bridge.dispose()
  assert.equal(
    env.win.cancelled.length,
    afterRun,
    'dispose 不得取消已经触发过的定时器（旧的 clearTimers 会）'
  )

  // ② 收到推送即出账：剩下的定时器被逐个取消，且之后 dispose 不再重复取消
  const env2 = makeEnv()
  const bridge2 = installThemeBridge({ window: env2.win, root: env2.root })
  env2.captureLog(() => env2.dispatch(PUSH('theme-dark', { '--bg': '#111111' })))
  assert.equal(env2.win.cancelled.length, 3, '收到推送时三个定时器都还没触发 → 逐个取消')
  bridge2.dispose()
  assert.equal(env2.win.cancelled.length, 3, 'dispose 不得重复取消（已出账的定时器不在表里）')

  // ③ 一个都没触发就 dispose：三个都取消（不能因为"出账"把该取消的漏掉）
  const env3 = makeEnv()
  const bridge3 = installThemeBridge({ window: env3.win, root: env3.root })
  bridge3.dispose()
  assert.equal(env3.win.cancelled.length, 3, '未触发的请求定时器必须逐个取消')
})
