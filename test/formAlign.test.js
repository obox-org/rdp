/**
 * 「表单对齐」门禁（用户要求：**选项名左对齐、固定长度；选项/输入框也左对齐，防止长度不一**）。
 *
 * 手法与 `componentSource.test.js` / `stylesTokens.test.js` 同款：**读源码文本**断言布局性质。
 * 为什么读源码而不挂载渲染：扩展没有 jsdom / @vue/test-utils，"控件左边缘是否真的在同一条
 * 竖线上"在单测里无法直接量（那需要真实排版引擎）；而这条性质**完全由几个 CSS 声明与模板落位
 * 决定**——把它们钉在文本上，即可让"有人把固定宽度改回 `auto`、或去掉左对齐"直接变红
 * （变异自证见 docs/evidence/align-mutation-M*.txt）。真实像素级复核由
 * docs/evidence/align-modal-common.png / align-modal-advanced.png 两张截图承担。
 *
 * 认定口径：
 *   ① 标签列**固定宽度**（`--label-w`，值不是 auto / max-content / fit-content / min-content），
 *      且该值**放得下 fields.js 里最长的标签**（按字体上界估算，字体漂移也不折行）；
 *   ② 标签与控件列都**左对齐**；
 *   ③ 说明行在**控件列内**（`grid-column: 2`；不是跨列、也不在标签列下方）；
 *   ④ 勾选框落在控件列（标签列留空占位）、成对字段的两个输入框在控件列内左对齐；
 *   ⑤ **窄窗口降级**规则存在：标签列与控件列改为上下堆叠。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { findChrome, measureDescLines } from './descLinesBrowser.mjs'
import { ADVANCED_GROUPS, COMMON_GROUPS } from '../src/fields.js'

const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)
/** 去掉块注释 / HTML 注释 / 行注释（同 componentSource.test.js），避免注释里的示例字符串喂出假绿 */
const FIELD = readFileSync(
  new URL('../src/components/ConnectionField.vue', import.meta.url),
  'utf8'
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

/**
 * 按**花括号配对**扫描所有 `@media (…) { … }` 块（不用正则跨块匹配——块内还有嵌套花括号，
 * `[\s\S]*?\n\}` 会在块内第一条规则处提前收尾，把后面的基础规则误当成媒体查询内容）。
 * 返回 { blocks, rest }：`blocks` 是每个媒体块的 query/body，`rest` 是挖掉媒体块后的基础规则正文。
 */
function scanMedia(text) {
  const blocks = []
  let rest = ''
  let cursor = 0
  const re = /@media\b/g
  let match
  while ((match = re.exec(text))) {
    const open = text.indexOf('{', match.index)
    if (open < 0) break
    let depth = 0
    let end = -1
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) break
    blocks.push({
      query: text.slice(match.index + '@media'.length, open).trim(),
      body: text.slice(open + 1, end)
    })
    rest += text.slice(cursor, match.index)
    cursor = end + 1
    re.lastIndex = cursor
  }
  return { blocks, rest: rest + text.slice(cursor) }
}

const { blocks: MEDIA_BLOCKS, rest: BASE_CSS } = scanMedia(CSS)

/** 把 CSS 拆成 [{ selectors, body }]（块内无嵌套花括号，够用） */
const RULES = [...BASE_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  body: m[2]
}))

/** 某选择器命中的**所有**规则体（按文件顺序，最后一条生效） */
function bodies(selector) {
  return RULES.filter((r) => r.selectors.includes(selector)).map((r) => r.body)
}

/** 某选择器最终生效的某个属性值（跨规则取最后一条；含简写不做展开） */
function decl(selector, property) {
  const found = bodies(selector)
    .flatMap((body) => [
      ...body.matchAll(new RegExp(`(?:^|[;{\\n])\\s*${property}\\s*:\\s*([^;]+);`, 'g'))
    ])
    .map((m) => m[1].trim())
  return found.length ? found[found.length - 1] : ''
}

/** 某选择器最终生效的**整条声明文本**（形如 `display: grid`，用于断言"是哪种取值"） */
function declaration(selector, property) {
  const value = decl(selector, property)
  return value ? `${property}: ${value}` : ''
}

/** `:root` 里某布局变量的值 */
function rootVar(name) {
  const block = CSS.match(/:root\s*\{([\s\S]*?)\}/)
  assert.ok(block, 'styles.css 应有一个 :root')
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block[1])
  assert.ok(match, `:root 里应有 ${name}`)
  return match[1].trim()
}

/**
 * 文本宽度的**字体上界估算**（不依赖具体字体是否装上）：
 * 全角字形（CJK 汉字 / 全角标点 / 全角形式）按 1em 的 1.15 倍、其余按 0.8em —— 覆盖宿主字体栈
 * 在 Windows 上解析到 `Microsoft YaHei` 时实测的 ~1.11em/全角字，也覆盖更宽的替代字体。
 */
const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\u303f\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/

function widthUpperBound(text, sizePx) {
  let em = 0
  for (const char of text) em += WIDE_CHAR.test(char) ? 1.15 : 0.8
  return em * sizePx
}

/** fields.js 里所有字段的标签（含必填星号） */
const LABELS = [...COMMON_GROUPS, ...ADVANCED_GROUPS]
  .flatMap((group) => group.fields)
  .map((field) => ({ key: field.key, text: `${field.label}${field.required ? ' *' : ''}` }))

/**
 * 字段的**说明行**文案（与 ConnectionField.vue 的 `desc` 计算属性同口径：`hint` 优先于 `desc`）。
 * 说明行是"每项一行灰字"的既有口径（设计 §4.3 / R-D4），**必须在一行内**。
 */
const DESCS = [...COMMON_GROUPS, ...ADVANCED_GROUPS]
  .flatMap((group) => group.fields)
  .map((field) => ({
    key: field.key,
    text: String(field.hint || field.desc || '').trim(),
    advanced: ADVANCED_GROUPS.some((g) => g.fields.includes(field))
  }))
  .filter((item) => item.text !== '')

/**
 * 1280 宽窗口下，一条说明行可用的**单行宽度**（px）——取**最紧**的那档（高级区），由布局现算。
 *
 * 算式（每项都有实测出处，见 docs/evidence/align-shots/measure-{common,advanced}.txt）：
 *   模态框 640（.modal 的 width，且 ≤100%，1280 视口下不受限）
 *   − .modal__body 左右内边距 2×20 = 40
 *   − .accordion__body 左右内边距 2×12 = 24（**高级区**才有；常用区实际可用更宽）
 *   − 标签列 --label-w（现读 :root，不写死）
 *   − 列间距 column-gap = 8
 *   = **420px**（实测高级区控件列宽正是 420；常用区 446）
 *
 * ⚠️ 这个数字只是**说明**用（A1⑧ 直接把 420/446 喂给真实排版夹具）；字符宽度估算在本字体栈上
 * 会高估 15%–47%，不能拿它当"是否折行"的判据（对照见 docs/evidence/align-measure/desc-widths.txt）。
 */
const DESC_LINE_BUDGET_PX = 640 - 2 * 20 - 2 * 12 - Number.parseFloat(rootVar('--label-w')) - 8

test('A1①：标签列是**固定宽度**（--label-w），且不是 auto / max-content / fit-content', () => {
  const labelW = rootVar('--label-w')
  assert.match(labelW, /^\d+(?:\.\d+)?(?:px|rem|em)$/, `--label-w 应是固定长度，实际是 ${labelW}`)
  assert.ok(
    !/auto|max-content|min-content|fit-content/.test(labelW),
    `--label-w 不得是内容驱动的关键字（auto/max-content/…），实际是 ${labelW}`
  )

  // 两列栅格：标签列吃 --label-w、控件列吃剩余（`minmax(0, …)` 防长内容撑出横向滚动）
  const template = decl('.field', 'grid-template-columns')
  assert.equal(template, 'var(--label-w) minmax(0, 1fr)', '.field 的两列栅格模板')
  assert.ok(
    /display\s*:\s*grid/.test(declaration('.field', 'display')),
    `.field 必须是栅格；实际 ${declaration('.field', 'display') || '(未声明)'}`
  )
  // 不得回退成"标签自己定宽、控件靠 flex 剩余"的写法（那正是各控件起点不齐的来源）
  assert.ok(
    !/flex\s*:\s*0\s+0\s+auto/.test(bodies('.field__label').join(';')),
    '.field__label 不得回退成 flex: 0 0 auto（宽度会随文字长短变化）'
  )
  assert.ok(
    !/margin-left\s*:\s*var\(--label-w\)/.test(CSS),
    '不得用"给说明行加 margin-left"的写法代替栅格列'
  )
})

test('A1②：--label-w 放得下 fields.js 里最长的标签（1280 窗口下不折行、不溢出）', () => {
  const size = Number.parseFloat(
    /'--font-size-sm'\s*:\s*'(\d+(?:\.\d+)?)px'/.exec(
      readFileSync(new URL('../src/theme.js', import.meta.url), 'utf8')
    )?.[1] ?? '12'
  )
  const budget = Number.parseFloat(rootVar('--label-w'))
  const measured = LABELS.map((l) => ({ ...l, w: widthUpperBound(l.text, size) })).sort(
    (a, b) => b.w - a.w
  )
  const worst = measured[0]
  assert.ok(
    worst.w <= budget,
    `最长标签「${worst.text}」(${worst.key}) 的宽度上界 ${worst.w.toFixed(1)}px 超过 --label-w ${budget}px —— ` +
      '要么把 --label-w 调大（并重测 docs/evidence/align-measure/），要么把标签改短'
  )
  // 也要钉住"确实有标签接近上限"：否则 --label-w 可以被无意义地放大（例如 400px）而门禁不响
  assert.ok(
    worst.w >= budget * 0.75,
    `最长标签只占 --label-w 的 ${((worst.w / budget) * 100).toFixed(0)}%（< 75%）⇒ --label-w 过大，` +
      '控件列被无谓压缩；请按实测重新取值'
  )
  // 1280 宽窗口下的横向预算：模态框 640（≤100%）→ 扣 .modal__body 左右各 20 → 高级区再各扣 12
  const rowWidth = 640 - 20 * 2 - 12 * 2
  const controlWidth = rowWidth - budget - 8
  assert.ok(controlWidth >= 320, `控件列只剩 ${controlWidth}px，长下拉项/长占位会开始折行`)
})

test('A1③：标签与控件列都**左对齐**', () => {
  assert.equal(decl('.field__label', 'text-align'), 'left', '标签必须左对齐（不是 center/right）')
  assert.equal(
    decl('.field__label', 'justify-self'),
    'start',
    '标签列内的标签必须靠列首（justify-self: start），长短标签的起始 x 才一致'
  )
  assert.equal(decl('.field__control', 'text-align'), 'left', '控件列必须左对齐')
  assert.equal(
    decl('.field__control', 'justify-self'),
    'stretch',
    '控件列必须从列首展开（justify-self: stretch）——控件左边缘即列左边缘'
  )
  // 不允许出现把标签推到右边 / 居中的写法
  assert.ok(
    !/justify-self\s*:\s*(?:end|center)/.test(bodies('.field__label').join(';')),
    '标签不得靠列尾或居中'
  )
})

test('A1④：说明行在**控件列内**（grid-column: 2），不跨到标签列下方', () => {
  assert.equal(decl('.field__desc', 'grid-column'), '2', '说明行必须落在第 2 列（控件列）')
  assert.equal(decl('.field__desc', 'grid-row'), '2', '说明行必须在控件之下另起一行')
  assert.equal(decl('.field__error', 'grid-column'), '2', '校验红字同样落在控件列')
  assert.equal(decl('.field__error', 'grid-row'), '3')
  assert.ok(
    !/grid-column\s*:\s*1\s*\/\s*-1/.test(bodies('.field__desc').join(';')),
    '说明行不得跨两列（那会跑到标签列下方）'
  )
  // 说明仍是"一行、简短"的既有口径（--fg-dim + --font-size-sm）
  assert.equal(decl('.field__desc', 'color'), 'var(--fg-dim)')
  assert.equal(decl('.field__desc', 'font-size'), 'var(--font-size-sm)')
  // select 的取值说明继续写在 option 文本/title 里，不新增下方逐项解释
  assert.ok(
    FIELD.includes('{{ option.value }} — {{ option.label }}'),
    'option 文本仍是"取值 — 短说明"'
  )
  assert.ok(!FIELD.includes('selectedOptionDesc'), '不得新增"当前选值"说明行')
})

test('A1⑤：勾选框落在控件列、成对字段的两个输入框在控件列内左对齐', () => {
  // 勾选框：标签列是空占位（否则方框会挤进标签列、与其它控件起点错开）
  assert.ok(
    FIELD.includes('field__label field__label--empty'),
    '勾选框字段必须有空标签占位，方框才能落到控件列'
  )
  assert.ok(
    /<span class="field__label field__label--empty" aria-hidden="true"><\/span>/.test(FIELD),
    '空占位必须是无文本、对读屏隐藏的元素'
  )
  // 空占位紧邻 .field__control，且 .check 包在控件列内
  const checkBlock = FIELD.slice(FIELD.indexOf('field__label--empty'))
  const controlAt = checkBlock.indexOf('field__control')
  const checkAt = checkBlock.indexOf('class="check"')
  assert.ok(
    controlAt >= 0 && checkAt > controlAt,
    '.check 必须在 .field__control 之内（控件列内左对齐）'
  )
  // `v-if` 时代的分支写法（方框直接在 .field__row 里）不许回来
  assert.ok(
    !/<label v-if="field\.type === 'check'" class="check"/.test(FIELD),
    '不得回退成"勾选框直接放在行内"（会挤进标签列，与其它控件起点错开）'
  )
  // 成对字段（分辨率 宽×高）：两个输入框都在控件列内、从左边缘等宽排布
  assert.ok(FIELD.includes('class="pair"'), '成对字段必须有 .pair 容器')
  assert.equal(decl('.pair', 'display'), 'flex')
  assert.equal(decl('.pair', 'align-items'), 'center')
  assert.equal(decl('.pair .input', 'flex'), '1 1 0', '两格等宽')
  assert.equal(decl('.pair .input', 'min-width'), '0', '两格可收缩，窄窗口不溢出')
  assert.equal(decl('.field__label--empty', 'height'), '0', '空占位不得把该行撑高')
  // 方框本身不许被压扁
  assert.equal(decl('.check input', 'flex'), '0 0 14px')
})

test('A1⑦：标签与控件必须是 `.field` 的**直接子元素**（不得再套一层嵌套栅格）', () => {
  // 结构性回归：曾经写成
  //   .field(两列栅格) > .field__row(又是两列栅格) > 标签 + 控件
  // 内层那一行被外层当成"第 1 列的栅格项"，宽度只有 --label-w ⇒ 控件列塌成 0px
  // （实测 grid-template-columns: 144px 0px，见 docs/evidence/align-shots/measure-common.txt）。
  assert.ok(
    !/<div class="field__row">/.test(FIELD),
    '模板不得再给"标签 + 控件"套 .field__row（嵌套栅格会让控件列塌成 0）'
  )
  assert.ok(
    !RULES.some((rule) => rule.selectors.includes('.field__row')),
    'styles.css 不得再为 .field__row 定义栅格（那条规则就是嵌套栅格的一半）'
  )
  // 栅格项必须真的是 .field 的直接子元素：模板里两者都直接出现在 `.field` 之下，
  // 且标签紧邻控件（标签在第 1 列、控件在第 2 列，二者同排）
  const labelAt = FIELD.indexOf('<label class="field__label" :for="inputId">')
  const controlAt = FIELD.indexOf('<div class="field__control">', labelAt)
  assert.ok(labelAt >= 0 && controlAt > labelAt, '.field__label 之后必须紧跟 .field__control')
  const between = FIELD.slice(labelAt, controlAt)
  assert.ok(
    !/<div\b/.test(between),
    '标签与控件之间不得再插一层 <div>（插了就是嵌套栅格，控件列会塌掉）'
  )
  // 说明与红字也必须是 `.field` 的直接子元素（否则 `grid-column: 2` 不生效）
  assert.ok(
    /\n    <p v-if="desc" class="field__desc">/.test(FIELD),
    '说明行必须是 .field 的直接子元素（缩进 4 空格，位于 .field 第一层）'
  )
  assert.ok(
    /\n    <p v-if="error" class="field__error">/.test(FIELD),
    '红字必须是 .field 的直接子元素'
  )
})

test('A1⑧：1280 宽窗口下**没有任何 desc 折行**（说明行恒为一行；窄窗口降级下允许折行，本门禁不管）', (t) => {
  // 量法：无头 Chrome 真实排版（test/descLinesBrowser.mjs + test/fixtures/desc-lines.html），
  // 每条 desc 放进一个宽度等于"该区控件列宽"的真实 <p> 里数行数。
  //
  // 为什么不用字符宽度估算：宿主字体栈上估算会**高估 15%–47%**（实测对照见
  // docs/evidence/align-measure/desc-widths.txt：估算 465.6px 的那条实际只占 364.4px），
  // 拿它当门禁会在 65 条里误报 11 条 —— 门禁必须与"用户真正看到的排版"同源。
  //
  // 控件列宽同样**由浏览器按真实 CSS 算出来**：测试从 src/styles.css **原样抽出**影响列宽的
  // 基础规则（跳过 @media，见 test/descLinesBrowser.mjs 的 extractWidthRules），夹具用它们渲染
  // 一段最小骨架（overlay → modal → modal__body → field / accordion__body → field），
  // 再量 `.field__control` 的实际宽度。所以不依赖"640 − 各种内边距"这类手算常量；布局一改它跟着变。
  if (!findChrome()) {
    t.skip('未找到无头浏览器，A1⑧ 无法真实排版（本机应装 Chrome）')
    return
  }

  const rows = DESCS.map((d) => ({
    key: d.key,
    scope: d.advanced ? 'advanced' : 'common',
    text: d.text
  }))
  const report = measureDescLines(rows, {})
  assert.equal(report.count, rows.length, '每条 desc 都应被量到（数量不符说明夹具没覆盖全）')

  // 量出来的控件列宽必须与 CSS 算式吻合（±8px 容差：模态框/容器的 1px 边框与滚动条占位）——
  // 否则说明夹具量错了东西，"无折行"的结论也不可信。
  const commonJ = 640 - 2 * 20 - Number.parseFloat(rootVar('--label-w')) - 8 // 446
  const advancedJ = commonJ - 2 * 12 // 422（实测 420，差 2px 是高级区滚动条占位）
  assert.equal(
    report.controlWidthsSource,
    'measured-from-real-css',
    '控件列宽必须由真实 CSS 算出来'
  )
  assert.ok(
    Math.abs(report.controlWidths.common - commonJ) <= 8,
    `夹具量出的常用区控件列宽 ${report.controlWidths.common}px 与 CSS 算式 ${commonJ}px 不符`
  )
  assert.ok(
    Math.abs(report.controlWidths.advanced - advancedJ) <= 8,
    `夹具量出的高级区控件列宽 ${report.controlWidths.advanced}px 与 CSS 算式 ${advancedJ}px 不符`
  )
  // 两个区都必须量到（否则可能只量到一半，绿色不可信）
  assert.ok(report.controlWidths.common > 400, '常用区控件列宽应 > 400px')
  assert.ok(report.controlWidths.advanced > 400, '高级区控件列宽应 > 400px')
  assert.ok(
    report.modalWidth > 600 && report.modalWidth < 700,
    `骨架里的模态框宽度 ${report.modalWidth}px 应接近 .modal 的 640px（否则不是 1280 窗口下那一档）`
  )
  // 高级区一定比常用区窄（多一层 .accordion__body 内边距）——否则说明抽规则时把两区搞混了
  assert.ok(
    report.controlWidths.advanced < report.controlWidths.common,
    '高级区控件列宽必须小于常用区（它多扣一层 12px 内边距）'
  )

  assert.deepEqual(
    report.wrapping.map(
      (w) => `${w.key}（${w.scope}，控件列 ${w.controlW}px）折成 ${w.lines} 行：「${w.text}」`
    ),
    [],
    '有说明行在 1280 宽窗口下折成多行 —— 请把该 desc 改短（设计 §4.3/R-D4：说明只有一行）'
  )

  // **自检：这套量法真的能测出折行**（否则"全绿"可能只是量法失效）
  // 把控件列强制压到 320px，必然有 desc 折行；若此时还报"无折行"，说明夹具坏了。
  const squeezed = measureDescLines(rows, { query: '?w=320' })
  assert.equal(squeezed.controlWidthsSource, 'forced', '自检必须真的用上强制宽度')
  assert.ok(
    squeezed.wrapping.length > 0,
    '把控件列压到 320px 后仍报"无折行" ⇒ 量测夹具失效，A1⑧ 的绿色不可信'
  )
  assert.ok(
    squeezed.wrapping.length >= report.wrapping.length + 1,
    '压窄后折行数没有增加 ⇒ 量测口径可疑'
  )
})

test('A1⑥：窄窗口降级规则存在（标签/控件改上下堆叠，且不出现横向滚动）', () => {
  // 只看"真的在管表单两列"的那条媒体查询（本文件另有 720px 的卡片栅格降级，与表单无关）
  const stacking = MEDIA_BLOCKS.filter(
    (block) => /max-width:\s*\d+px/.test(block.query) && /\.field\b/.test(block.body)
  )
  assert.ok(stacking.length > 0, '必须有一条 max-width 媒体查询把表单两列栅格降级')
  const block = stacking[0]
  const breakpoint = Number.parseFloat(/max-width:\s*(\d+)px/.exec(block.query)[1])
  const labelW = Number.parseFloat(rootVar('--label-w'))
  assert.ok(
    breakpoint > labelW,
    `降级断点 ${breakpoint}px 必须大于标签列宽 ${labelW}px（否则降级前控件列已被压到 0）`
  )
  // 断点还要放得下"两列可用的下限"：模态框在窄窗口下是 `width: calc(100% - 32px)`（.overlay 的 16px 内边距）
  //   ⇒ 行宽 = 视口 - 32(overlay) - 40(.modal__body 左右各 20) - 24(高级区左右各 12)
  const minControlWidth = 320
  const needed = labelW + 8 + minControlWidth + 32 + 40 + 24
  assert.ok(
    breakpoint === needed,
    `降级断点应从"两列仍够用"的最小视口宽反推：期望 ${needed}px，实际 ${breakpoint}px`
  )
  // 该块必须真的把 .field 收成单列
  const rule = [...block.body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
    m[1]
      .split(',')
      .map((s) => s.trim())
      .includes('.field')
  )
  assert.ok(rule, '.field 必须在窄窗口降级块里')
  assert.match(
    rule[2],
    /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/,
    '.field 降级后必须是单列（minmax(0, 1fr)）——标签与控件改为上下堆叠'
  )
  assert.ok(
    !RULES.some((r) => r.selectors.includes('.field__row')),
    '不得靠"再拿 .field__row 覆盖一次"实现降级（那说明还留着嵌套栅格）'
  )
  // 降级后说明行要回到唯一那一列，否则会与控件挤在同一格
  assert.match(block.body, /\.field__desc[\s\S]*?grid-column\s*:\s*1/)
  assert.match(block.body, /\.field__error[\s\S]*?grid-column\s*:\s*1/)
  // 兜底：长内容不得撑出横向滚动；模态框不得靠 overflow-x 藏掉溢出
  assert.equal(decl('.modal__body', 'overflow-wrap'), 'anywhere')
  assert.ok(!/overflow-x\s*:\s*(?:auto|scroll)/.test(CSS), '不得用横向滚动条"藏"对齐问题')
  // 视口声明必须在（移动/窄窗口下按真实宽度排版）
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8')
  assert.ok(
    /name="viewport"/.test(html) && /width=device-width/.test(html),
    '必须声明 viewport 宽度'
  )
})
