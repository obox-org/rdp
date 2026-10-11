/**
 * 「desc 单行」门禁的**无头 Chrome 量测夹具**（由 test/formAlign.test.js 的 A1⑧ 使用）。
 *
 * 做什么：把扩展**真实运行时**的说明排版跑一遍 —— 对每条 desc 建一个宽度等于"控件列宽"的
 * 真实 `<p>`（同字体、同字号 12px、同行高 1.5），量出它占几行。
 *
 * 为什么不用字符宽度估算：宿主字体栈上估算会高估 15%–47%（实测对照见
 * docs/evidence/align-measure/desc-widths.txt），当门禁会大规模误报（65 条里误报 11 条）。
 *
 * 夹具自包含：说明文案由测试从 `src/fields.js` 现取后注入 `__RDP_DESC_ROWS__` 占位符，
 * **不复制 fields.js**，所以不存在副本漂移。`?w=<px>` 可把两个区都换成给定宽度，
 * 用于自检"这套量法真的能测出折行"。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE = readFileSync(new URL('./fixtures/desc-lines.html', import.meta.url), 'utf8')
const STYLES_URL = new URL('../src/styles.css', import.meta.url)

/** 去掉注释后的 styles.css 正文 */
function strippedCss() {
  return readFileSync(STYLES_URL, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 把 CSS 里的**裸规则**（`选择器 { … }`）按文件顺序列出来；`@media` 等 at-rule 的块体**整段跳过**
 * （否则块内的窄窗口覆盖会被当成无条件规则，例如 `.field { grid-template-columns: minmax(0,1fr) }`
 * 会被误当成基础规则，量出来的控件列宽就永远是 600px 而不是 446px）。
 */
function bareRules(css) {
  const rules = []
  let i = 0
  while (i < css.length) {
    // 跳过 at-rule（@media/@supports/@font-face…）：连同它的块体一起跳过
    if (css[i] === '@') {
      const open = css.indexOf('{', i)
      if (open < 0) break
      let depth = 0
      let end = -1
      for (let j = open; j < css.length; j += 1) {
        if (css[j] === '{') depth += 1
        else if (css[j] === '}') {
          depth -= 1
          if (depth === 0) {
            end = j
            break
          }
        }
      }
      i = end < 0 ? css.length : end + 1
      continue
    }
    if (css[i] === '}') {
      i += 1
      continue
    }
    const open = css.indexOf('{', i)
    if (open < 0) break
    const close = css.indexOf('}', open)
    if (close < 0) break
    rules.push({
      selectors: css
        .slice(i, open)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      body: css.slice(open + 1, close)
    })
    i = close + 1
  }
  return rules
}

/**
 * 从 styles.css 里**原样抽出**影响"控件列宽"的那些基础规则（盒模型、标签列固定宽、栅格间距、
 * 各级容器内边距、勾选框的空占位高度）。
 *
 * 为什么要抽真实规则而不是让夹具自己写一份：夹具一旦自带宽度常量，CSS 改了它就失真
 * （门禁会看着绿、实际早已折行）。抽取之后，`--label-w` 或内边距一改，夹具量出的列宽
 * 就跟着变，A1⑧ 与真实排版始终同源。
 */
export function extractWidthRules() {
  const wanted = new Set([
    '*',
    ':root',
    '.overlay',
    '.field',
    '.field--full',
    '.field__label',
    '.field__control',
    '.field__label--empty',
    '.modal',
    '.modal__body',
    '.accordion__body'
  ])
  const found = new Map()
  for (const rule of bareRules(strippedCss())) {
    if (!rule.selectors.length) continue
    if (!rule.selectors.every((s) => wanted.has(s))) continue
    for (const selector of rule.selectors) {
      found.set(selector, (found.get(selector) ?? '') + rule.body)
    }
  }
  const missing = [...wanted].filter((s) => !found.has(s))
  if (missing.length) {
    throw new Error(
      `styles.css 里找不到这些影响控件列宽的规则：${missing.join(', ')} —— ` +
        'A1⑧ 的列宽推算依赖它们，请同步 test/descLinesBrowser.mjs 的 extractWidthRules()'
    )
  }
  return [...found.entries()].map(([selector, body]) => `${selector} {${body}}`).join('\n')
}

/** 常见 Chrome/Edge 安装位置（可用 CHROME_PATH 覆盖） */
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean)

export function findChrome() {
  return CANDIDATES.find((path) => existsSync(path)) ?? null
}

/**
 * 量一遍所有 desc 在**真实排版**下占几行（控件列宽由浏览器按真实 CSS 规则算出来）。
 *
 * @param {Array<{key: string, scope: 'common'|'advanced', text: string}>} rows 说明文案
 * @param {{ query?: string }} [options] `query` 透传给夹具（如 `?w=320` 强制列宽，用于自检）
 * @returns {{ stageWidth: number, controlWidths: {common: number, advanced: number},
 *             controlWidthsSource: string, count: number, wrapping: Array, keys: string[] }}
 */
export function measureDescLines(rows, options = {}) {
  const chrome = findChrome()
  if (!chrome) {
    throw new Error(
      '找不到无头浏览器（Chrome/Edge）。A1⑧ 需要真实排版来判定"说明是否折行"；' +
        '请安装 Chrome，或用 CHROME_PATH 指向可执行文件。'
    )
  }
  const html = TEMPLATE.replace('__RDP_DESC_ROWS__', JSON.stringify(rows)).replace(
    '__RDP_WIDTH_CSS__',
    extractWidthRules()
  )
  const dir = mkdtempSync(join(tmpdir(), 'rdp-desc-lines-'))
  const page = join(dir, 'desc-lines.html')
  writeFileSync(page, html, 'utf8')
  try {
    const query = options.query ?? ''
    const url = `file:///${page.replace(/\\/g, '/')}${query}`
    // 页面是**一次性**的：脚本同步跑完就写结果，没有异步等待 ⇒ `--virtual-time-budget` 足够，
    // 而且不需要 iframe（`--dump-dom` 只等主文档 load，子框架的内容它不等）。
    const dump = execFileSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--allow-file-access-from-files',
        '--window-size=1400,900',
        '--virtual-time-budget=4000',
        '--dump-dom',
        url
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 8 * 1024 * 1024,
        timeout: 90_000
      }
    )
    const match = /DESC_MEASURE=(\{[\s\S]*?\})<\/pre>/.exec(dump)
    if (!match) {
      // 只从 <pre id="out"> 里取错误（不能在整个 dump 上找 "DESC_MEASURE_ERROR="：
      // 夹具源码里也有这个字面量，会把脚本原文当成错误信息）
      const out = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dump)
      const error = out && /DESC_MEASURE_ERROR=([^\n<]*)/.exec(out[1])
      throw new Error(
        error
          ? `量测夹具报错：${error[1]}`
          : '量测夹具没有产出 DESC_MEASURE（页面未执行完？），out 内容：' +
              (out ? out[1].slice(0, 300) : '(找不到 #out)')
      )
    }
    return JSON.parse(match[1])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 夹具文件路径（供测试断言模板存在） */
export const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/desc-lines.html', import.meta.url))
