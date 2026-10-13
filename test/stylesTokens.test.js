/**
 * R-D1 的 token 化门禁（设计 §2.6 核查 1–3 的自动化版本 + §7.1 的两条兜底覆盖用例）。
 *
 * 判定口径：`styles.css` **零自造色值 / 零自造字体族 / 只引用白名单 token**，且它消费的 token
 * 一定在 `src/theme.js` 的 `FALLBACK_TOKENS` 里（推送未达也不空白），而兜底表的键又必须全在
 * 宿主 token 白名单内（兜底表不得自造 token）。
 *
 * 注意：扫描前会剥掉 CSS 注释——注释不是声明，设计 §2.6 的手工命令在正文上跑（本文件正文
 * 不含任何 `var(--…` 之外的注释引用，故手工命令与这里的结果一致）。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { FALLBACK_TOKENS } from '../src/theme.js'

const SRC = new URL('../src/styles.css', import.meta.url)
const RAW = readFileSync(SRC, 'utf8')
/** 去掉注释后的正文（`/* … *\/`；本文件不用 `//` 注释） */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '')

/** 宿主 token 白名单（25 个，逐条对齐 `src/renderer/src/assets/main.css:2-29`） */
const HOST_THEME_TOKEN_NAMES = [
  '--bg',
  '--bg-panel',
  '--bg-sidebar',
  '--bg-titlebar',
  '--bg-input',
  '--border',
  '--fg',
  '--fg-dim',
  '--fg-bright',
  '--fg-link',
  '--fg-error',
  '--fg-warning',
  '--fg-success',
  '--accent',
  '--hover-bg',
  '--selection-bg',
  '--nav-icon',
  '--statusbar-bg',
  '--statusbar-fg',
  '--font-family',
  '--font-size',
  '--font-size-sm',
  '--font-size-lg',
  '--icon-size',
  '--nav-icon-size'
]
/** 扩展自有的**布局**变量（设计 §2.5 E1：宿主 token 清单里没有圆角/栅格宽度） */
const EXTENSION_LAYOUT_VARS = ['--radius', '--radius-lg', '--label-w']

const COLOR_KEYWORDS =
  /:\s*(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|brown|navy|teal|olive|maroon|lime|aqua|fuchsia)\b/gi

function matches(text, regex) {
  return [...text.matchAll(regex)].map((m) => m[0])
}

/** `var(--x)` 引用的变量名（去重排序） */
function usedTokens(text) {
  return [
    ...new Set(matches(text, /var\(\s*(--[a-z0-9-]+)/g).map((m) => m.replace(/^var\(\s*/, '')))
  ]
    .slice()
    .sort()
}

/** 宿主 `:root` 里的自定义属性名（按出现顺序） */
const HOST_MAIN_CSS = new URL('../../../src/renderer/src/assets/main.css', import.meta.url)

function hostRootTokenNames() {
  const hostCss = readFileSync(HOST_MAIN_CSS, 'utf8')
  const block = hostCss.match(/:root\s*\{([\s\S]*?)\}/)
  assert.ok(block, '宿主 main.css 里应能找到 :root 块')
  return matches(block[1], /--[a-z0-9-]+(?=\s*:)/g)
}

test('styles.css 零自造色值（hex / rgb(a) / hsl(a) / 颜色关键字）', () => {
  const hex = matches(CSS, /#[0-9a-fA-F]{3,8}\b/g)
  const fn = matches(CSS, /\b(?:rgba?|hsla?)\(/g)
  const word = matches(CSS, COLOR_KEYWORDS)
  // 基线（改前）：hex 23 + 函数式 6 + 关键字 0 = 29 处命中
  assert.deepEqual({ hex, fn, word }, { hex: [], fn: [], word: [] })
})

test('styles.css 零自造字体族', () => {
  // 注意：设计 §2.6 给的原正则是 `font-family\s*:\s*(?!inherit|var\(--font-family\))`，
  // 它在零宽断言前放了 `\s*`，回溯后会把 `font-family: var(--font-family)` 也判为命中（5 处误报）；
  // 这里把 `\s*` 收进断言内部，语义才是"值既不是 inherit 也不是宿主字体族 token"。
  const fam = matches(CSS, /font-family\s*:\s*(?!\s*(?:inherit|var\(--font-family\)))/g)
  const mono = matches(CSS, /\b(?:Consolas|Cascadia|Menlo|Monaco|Courier|monospace)\b/g)
  assert.deepEqual({ fam, mono }, { fam: [], mono: [] })
})

test('styles.css 仅引用白名单 token + 扩展自有布局变量', () => {
  const used = usedTokens(CSS)
  const allowed = [...HOST_THEME_TOKEN_NAMES, ...EXTENSION_LAYOUT_VARS]
  assert.deepEqual(
    used.filter((name) => !allowed.includes(name)),
    [],
    '出现了白名单之外的变量'
  )
  assert.ok(used.length > 10, '至少应真的引用了一批 token')
})

test('styles.css 的 :root 只保留布局变量 --radius / --radius-lg / --label-w（自造颜色 token 块必须删除）', () => {
  const block = CSS.match(/:root\s*\{([\s\S]*?)\}/)
  assert.ok(block, 'styles.css 应保留一个 :root（只放布局变量）')
  const declared = matches(block[1], /--[a-z0-9-]+(?=\s*:)/g)
  assert.deepEqual([...declared].sort(), [...EXTENSION_LAYOUT_VARS].sort())
})

test('styles.css 消费的每个 token 都在 FALLBACK_TOKENS 内（推送未达也不空白）', () => {
  const missing = usedTokens(CSS).filter(
    (name) => !EXTENSION_LAYOUT_VARS.includes(name) && !(name in FALLBACK_TOKENS)
  )
  assert.deepEqual(missing, [], '这些 token 没有兜底值，拿不到推送时会变成"无值"')
})

test('FALLBACK_TOKENS 的键全部在宿主 token 白名单内（兜底表不得自造 token）', () => {
  const keys = Object.keys(FALLBACK_TOKENS).sort()
  assert.deepEqual(
    keys.filter((name) => !HOST_THEME_TOKEN_NAMES.includes(name)),
    []
  )
  // ⚠️ 这里**不再**断言"兜底表与宿主白名单逐条相等"：白名单是**宿主**的 25 项（含本界面不消费的
  // `--statusbar-bg` / `--bg-titlebar` 等），而兜底表按"只放界面真会消费的 token"口径维护
  // （1.0.3 移除状态栏后是 23 项）。真正的两个方向是：上面这条"兜底 ⊆ 白名单"，
  // 以及上一条"界面消费的都有兜底"。删除的功能由下面点名的那两条断言负责防复活。
  assert.ok(keys.length > 0, '兜底表不能是空表')
  for (const [name, value] of Object.entries(FALLBACK_TOKENS)) {
    assert.equal(typeof value, 'string', `${name} 的兜底值应是字符串`)
    assert.ok(value.trim() !== '', `${name} 的兜底值不能为空`)
  }
  // 状态栏已删除 ⇒ 兜底表不得留 statusbar token（宿主白名单仍是 25 项，不动）
  assert.ok(!('--statusbar-bg' in FALLBACK_TOKENS), '兜底表不得再留 --statusbar-bg')
  assert.ok(!('--statusbar-fg' in FALLBACK_TOKENS), '兜底表不得再留 --statusbar-fg')
})

test('宿主 main.css 的 :root 与白名单逐条一致（token 漂移即红）', (t) => {
  // 扩展是本仓库内的独立工程：宿主文件不在（例如把扩展目录单独拷走）时跳过，避免假红
  if (!existsSync(HOST_MAIN_CSS)) return t.skip('未找到宿主 main.css（扩展目录被单独拷出仓库）')
  assert.deepEqual(hostRootTokenNames().sort(), [...HOST_THEME_TOKEN_NAMES].sort())
})
