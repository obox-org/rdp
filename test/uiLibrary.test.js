/**
 * 组件库接入门禁（v1.1 起）。
 *
 * 为什么把原来的 `stylesTokens.test.js` / `formAlign.test.js` / `fallbackInputs.test.js` 换成这一份：
 * 那三个文件解析的是**本扩展的 `src/styles.css`**（零自造色值、两列栅格对齐、控件兜底色…）。
 * 现在扩展**不再带样式表**——按钮/输入/卡片/弹窗/空态的外观与对齐全部由宿主组件库
 * `app://obox/ui.css` 提供，对应的门禁也搬到了宿主仓库（`test/ui-css.test.ts`：
 * 无十六进制色值、无裸元素选择器、全部 `obox-` 前缀、状态用语义属性）。
 *
 * 本文件守住"扩展这一侧"的契约：
 * 1. 不再有自带 CSS；
 * 2. 页面确实引入了宿主组件库；
 * 3. 组件只用组件库的 class（旧的 `.field__*` / `.card__*` / `.modal__*` / `.btn` 一律不许回来）；
 * 4. 模板结构仍保留"标签列 + 控件列 + 说明/错误与控件左对齐"的 4 个槽位；
 * 5. `src/` 里没有任何色值字面量（颜色只能来自主题 token，由库统一消费）。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SRC = new URL('../src/', import.meta.url)

function read(rel) {
  return readFileSync(new URL(rel, SRC), 'utf8')
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = new URL(`${name}/`, dir)
    const stat = statSync(fileURLToPath(full))
    if (stat.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const FILES = walk(SRC)
const SCRIPTS = FILES.filter((file) => /\.(vue|js|mjs|ts|html)$/.test(file.pathname))
const TEMPLATES = FILES.filter((file) => file.pathname.endsWith('.vue')).map((file) => ({
  name: file.pathname.split('/src/')[1],
  text: readFileSync(file, 'utf8')
}))

/** 去掉注释后的源码（避免注释里的类名/色值影响断言） */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

test('src 下不再有自带样式表（外观全部交给宿主组件库）', () => {
  const css = FILES.filter((file) => file.pathname.endsWith('.css'))
  assert.deepEqual(
    css.map((file) => file.pathname.split('/src/')[1]),
    [],
    '不应再有 .css 文件；需要通用外观请在宿主 ui.css 里补组件'
  )
})

test('页面引入宿主组件库 app://obox/ui.css', () => {
  const html = read('index.html')
  assert.match(html, /<link[^>]+rel="stylesheet"[^>]+href="app:\/\/obox\/ui\.css"/)
  assert.match(html, /<body[^>]*class="obox-base"/)
})

test('main.js 不再 import 本地样式表', () => {
  const main = read('main.js')
  assert.ok(!/\.css['"]/.test(main), 'main.js 不应 import 任何 .css')
})

test('组件只用组件库 class：旧类名一律不许回来', () => {
  const legacy = [
    'class="card"',
    'card__title',
    'card__subtitle',
    'card__actions',
    'class="btn',
    'field__label',
    'field__control',
    'field__desc',
    'field__error',
    'modal__header',
    'modal__body',
    'modal__footer',
    'class="modal',
    'class="overlay"',
    'class="input',
    'class="select',
    'class="check"'
  ]
  for (const { name, text } of TEMPLATES) {
    const code = stripComments(text)
    for (const needle of legacy) {
      assert.ok(!code.includes(needle), `${name} 仍在使用旧类名 ${needle}`)
    }
  }
})

test('表单字段用库的 4 个槽位：label / control / desc / error', () => {
  const field = stripComments(read('components/ConnectionField.vue'))
  for (const cls of [
    'obox-form-row',
    'obox-form-row__label',
    'obox-form-row__control',
    'obox-form-row__desc',
    'obox-form-row__error'
  ]) {
    assert.ok(field.includes(cls), `ConnectionField.vue 缺少 ${cls}`)
  }
  // 勾选框保留空标签列占位：方框与其它控件左边缘对齐
  assert.match(field, /v-if="field\.type === 'check'"/)
  assert.match(field, /obox-form-row__label" aria-hidden="true"/)
  // 成对字段（分辨率）用库的成对布局
  assert.ok(field.includes('obox-field-pair'))
})

test('弹窗与确认框用库的 modal 结构', () => {
  const modal = stripComments(read('components/ConnectionModal.vue'))
  const del = stripComments(read('components/DeleteConfirm.vue'))
  for (const cls of ['obox-modal__mask', 'obox-modal__panel', 'obox-modal__header', 'obox-modal__body', 'obox-modal__footer']) {
    assert.ok(modal.includes(cls), `ConnectionModal.vue 缺少 ${cls}`)
    assert.ok(del.includes(cls), `DeleteConfirm.vue 缺少 ${cls}`)
  }
  assert.ok(modal.includes('obox-disclosure'), '高级选项应使用库的折叠区')
})

test('空态与卡片用库结构', () => {
  const empty = stripComments(read('components/EmptyState.vue'))
  const card = stripComments(read('components/ConnectionCard.vue'))
  assert.ok(empty.includes('obox-empty'))
  assert.ok(empty.includes('obox-empty__icon'))
  assert.ok(card.includes('obox-card'))
  assert.ok(card.includes('obox-card__footer'))
})

test('src 里没有色值字面量（颜色只能来自主题 token）', () => {
  const colour = /#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\(/
  for (const file of SCRIPTS) {
    const text = stripComments(readFileSync(file, 'utf8'))
    assert.ok(
      !colour.test(text),
      `${file.pathname.split('/src/')[1]} 含色值字面量；颜色请用 var(--token) 或组件库 class`
    )
  }
})

test('theme.js 仍保留首帧兜底（库的颜色全部来自 token）', () => {
  const theme = read('theme.js')
  assert.match(theme, /export const FALLBACK_TOKENS/)
  assert.ok(theme.includes("'--bg'"), '兜底表必须覆盖 --bg')
})

test('入口仍先装主题桥再 mount', () => {
  const main = read('main.js')
  assert.ok(main.indexOf('installThemeBridge()') < main.indexOf('createApp(App).mount'))
})

test('不引入宿主私有模块（页面只能走消息桥）', () => {
  for (const file of SCRIPTS) {
    const text = readFileSync(file, 'utf8')
    assert.ok(!/from ['"][^'"]*core\//.test(text), `${file.pathname.split('/src/')[1]} 不应 import 宿主内部模块`)
  }
})

test('删除的旧样式表确实不存在', () => {
  assert.equal(existsSync(fileURLToPath(new URL('../src/styles.css', import.meta.url))), false)
})
