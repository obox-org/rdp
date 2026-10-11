/**
 * N1 回归门禁：**"只拿到兜底 token"时的可读性**（用户实测："高级选项里文本框基本上看不清"）。
 *
 * 根因（2026-10-11 实测复核）：`styles.css` 只写裸 `var(--token)`，配色全部来自
 * `installThemeBridge()` 同步写入的 `FALLBACK_TOKENS`；而宿主 dark 默认 token 里
 * `--bg-input` 与 `--border` 是**同一个值**（#3c3c3c），高级区容器 `.accordion` 又用了
 * `background: var(--bg-input)` ⇒ 输入框的底色、描边与它的容器**三者同色** ⇒ 框"消失了"，
 * 只剩一个对比度 2.16:1 的 placeholder（`--fg-dim` on `--bg-input`）。
 * 本轮把 `.accordion` 改回最深一档 `--bg`，形成 面板 → 凹槽 → 输入框 三层。
 *
 * 本文件把这件事钉成机器可判的断言（不依赖人眼看截图）：
 *   ① 输入类控件消费的**每一个** token 都必须有兜底值（拿不到推送也不能"无值"）；
 *   ② 输入框的底色**不得**与任何容器的底色相同（这是 N1 的直接回归点）；
 *   ③ 文字/placeholder 与底色的 WCAG 对比度必须达到给定下限（placeholder 一档按设计 §2.5 E6 的口径）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { FALLBACK_TOKENS } from '../src/theme.js'

const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** 把 CSS 拆成 [{ selectors: [...], body }]（块内无嵌套花括号，够用） */
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  body: m[2]
}))

/** 命中某个选择器的**所有**规则（同名选择器可能出现多条，按文件顺序即层叠顺序） */
function rulesFor(selector) {
  const matched = RULES.filter((r) => r.selectors.includes(selector))
  assert.ok(matched.length > 0, `styles.css 里找不到规则 ${selector}`)
  return matched
}

/** 取某条选择器最终生效的 `background` 值（跨规则/同规则都取最后一个） */
function backgroundOf(selector) {
  const decls = rulesFor(selector).flatMap((rule) =>
    [...rule.body.matchAll(/background\s*:\s*([^;]+);/g)].map((m) => m[1].trim())
  )
  assert.ok(decls.length > 0, `${selector} 没有 background 声明`)
  return decls[decls.length - 1]
}

/** 声明值 → 它引用的 token 名（裸 var 引用；本文件只处理这种形态） */
function tokenOf(value) {
  const match = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value)
  assert.ok(match, `期望是裸 var(--token)，实际是 ${value}（若改成字面量，请一并更新本门禁）`)
  return match[1]
}

/** `#rgb` / `#rrggbb` → {r,g,b}；其它形态（rgba/color-mix）直接报错，避免"悄悄比较失败" */
function rgbOfToken(name) {
  const value = FALLBACK_TOKENS[name]
  assert.ok(value !== undefined, `${name} 没有兜底值`)
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  assert.ok(hex, `${name} 的兜底值 ${value} 不是 hex，本门禁需要扩展解析（别静默跳过）`)
  const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16)
  }
}

/** WCAG 相对亮度 */
function luminance({ r, g, b }) {
  const channel = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 对比度（1–21） */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 输入类控件（含它们的一行说明）用到的规则 */
const CONTROL_RULES = [
  '.input',
  '.select',
  '.input::placeholder',
  '.check',
  '.check input',
  '.field__label',
  '.field__desc',
  '.field__error',
  '.field__required',
  '.pair__sep',
  '.accordion',
  '.accordion__toggle',
  '.modal',
  '.modal__body'
]

/** 输入框"可能落在其中"的容器规则：它们的底色不许与输入框底色相同 */
const CONTAINER_RULES = ['.accordion', '.modal', 'body', '.app__header', '.card']

/** 扩展自有的**布局**变量（宿主 token 清单里没有圆角/栅格宽度）：不是主题 token，不走兜底表 */
const EXTENSION_LAYOUT_VARS = ['--radius', '--radius-lg', '--label-w']

test('N1①：输入类控件消费的每个 token 都有兜底值（拿不到推送也不出现"无值"）', () => {
  const used = new Set()
  for (const selector of CONTROL_RULES) {
    for (const rule of rulesFor(selector)) {
      for (const match of rule.body.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)) used.add(match[1])
    }
  }
  // 输入框的"四个面"（底、字、边、placeholder）必须都在兜底表里
  for (const key of ['--bg-input', '--fg', '--border', '--fg-dim']) {
    assert.ok(used.has(key), `${key} 应被输入类控件消费（否则这条门禁的口径就不对了）`)
  }
  const missing = [...used]
    .filter((name) => !EXTENSION_LAYOUT_VARS.includes(name) && !(name in FALLBACK_TOKENS))
    .sort()
  assert.deepEqual(missing, [], '这些 token 没有兜底值 ⇒ 宿主没推送时控件会变成"无值"')
})

test('N1②：输入框底色不得与其容器的底色相同（N1 的直接回归点）', () => {
  const inputBgToken = tokenOf(backgroundOf('.input'))
  const selectBgToken = tokenOf(backgroundOf('.select'))
  assert.equal(selectBgToken, inputBgToken, '下拉框与文本框必须同底色')
  const inputBg = rgbOfToken(inputBgToken)
  for (const selector of CONTAINER_RULES) {
    const containerToken = tokenOf(backgroundOf(selector))
    const sameToken = containerToken === inputBgToken
    const sameColor =
      !sameToken && JSON.stringify(rgbOfToken(containerToken)) === JSON.stringify(inputBg)
    assert.ok(
      !sameToken && !sameColor,
      `${selector} 的底色（${containerToken}）与输入框底色（${inputBgToken}）相同/同色 ⇒ 框会看不见（N1 就是这个问题）`
    )
    // 三层要"看得见"：底色差至少 1.3:1（纯色块的可辨下限；不断言 3:1，那是文字标准）
    assert.ok(
      contrast(inputBg, rgbOfToken(containerToken)) >= 1.3,
      `${selector} 与输入框底色的对比度 ${contrast(inputBg, rgbOfToken(containerToken)).toFixed(2)} < 1.3`
    )
  }
})

test('N1③：仅兜底状态下的对比度（正文 ≥ 4.5:1；placeholder 按设计 E6 的口径记录实测值）', () => {
  const inputBg = rgbOfToken(tokenOf(backgroundOf('.input')))
  const fg = rgbOfToken('--fg')
  const fgDim = rgbOfToken('--fg-dim')
  const bodyBg = rgbOfToken(tokenOf(backgroundOf('body')))

  assert.ok(contrast(fg, inputBg) >= 4.5, `输入文字/输入框底 ${contrast(fg, inputBg).toFixed(2)}`)
  assert.ok(contrast(fg, bodyBg) >= 4.5, `正文/窗口底 ${contrast(fg, bodyBg).toFixed(2)}`)
  assert.ok(
    contrast(fg, rgbOfToken(tokenOf(backgroundOf('.modal')))) >= 4.5,
    '正文/面板底 必须 ≥ 4.5'
  )
  // placeholder 用 --fg-dim（宿主没有 placeholder 专用 token，设计 §2.5 E6）：
  // 实测 ≈2.2:1，低于正文标准——这是宿主 token 取值决定的既有事实，本门禁只钉"不许更差"。
  const placeholder = contrast(fgDim, inputBg)
  assert.ok(placeholder >= 2, `placeholder/输入框底 ${placeholder.toFixed(2)} < 2`)
  assert.ok(
    placeholder < 4.5,
    '兜底表若把 --fg-dim 调亮到 4.5:1 以上，请同步复核宿主 light 主题与设计 E6 的口径'
  )
})
