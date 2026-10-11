/**
 * 「表单对齐」门禁的**变异自证**（红 → 还原 → 绿）。
 *
 * 做法：对 styles.css / ConnectionField.vue 逐个施加一处**故意退化**（把固定宽度改回内容驱动、
 * 去掉左对齐、把说明行挪出控件列、拆掉窄窗口降级、把嵌套栅格加回来），跑
 * `node --test test/formAlign.test.js` 记下红/绿，再还原字节。
 *
 * 用法：node scripts/mutate-align-gates.mjs        （在工作区根即 extensions/rdp 下执行）
 * 证据：docs/evidence/align-mutation-A1*.txt
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const CSS_URL = new URL('src/styles.css', ROOT)
const FIELD_URL = new URL('src/components/ConnectionField.vue', ROOT)
const FIELDS_URL = new URL('src/fields.js', ROOT)

/** 每条变异：文件 + 一处字面替换（必须恰好命中一次）+ 期望变红的门禁 */
const MUTATIONS = [
  {
    id: 'A1-10',
    title: '把「密码」的 desc 改回原长句（1280 下会折两行）',
    file: FIELDS_URL,
    from: "desc: '只交本机凭据管理器（cmdkey），不写 .rdp / 不入库，清空即删除。'",
    to: "desc: '只交本机凭据管理器（cmdkey），不写 .rdp、不入库；编辑时清空即删除已存密码。'",
    expect: 'A1⑧'
  },
  {
    id: 'A1-1',
    title: '把标签列固定宽度改回内容驱动（auto）',
    file: CSS_URL,
    from: 'grid-template-columns: var(--label-w) minmax(0, 1fr);',
    to: 'grid-template-columns: auto minmax(0, 1fr);',
    expect: 'A1①'
  },
  {
    id: 'A1-2',
    title: '把标签列宽度改成 max-content（宽度随文字长短变化）',
    file: CSS_URL,
    from: '--label-w: 144px;',
    to: '--label-w: max-content;',
    expect: 'A1①'
  },
  {
    id: 'A1-3',
    title: '把 --label-w 调小到放不下最长标签（120px）',
    file: CSS_URL,
    from: '--label-w: 144px;',
    to: '--label-w: 120px;',
    expect: 'A1②'
  },
  {
    id: 'A1-4',
    title: '去掉标签列的左对齐（justify-self: start → end）',
    file: CSS_URL,
    from: '  justify-self: start;\n  text-align: left;\n  color: var(--fg-dim);',
    to: '  justify-self: end;\n  text-align: left;\n  color: var(--fg-dim);',
    expect: 'A1③'
  },
  {
    id: 'A1-5',
    title: '把控件列改成不展开（justify-self: stretch → end）',
    file: CSS_URL,
    from: '  justify-self: stretch;\n  text-align: left;\n  min-width: 0;\n}',
    to: '  justify-self: end;\n  text-align: left;\n  min-width: 0;\n}',
    expect: 'A1③'
  },
  {
    id: 'A1-6',
    title: '把说明行挪出控件列（grid-column: 2 → 1）',
    file: CSS_URL,
    from: '.field__desc,\n.field__hint {\n  grid-column: 2;',
    to: '.field__desc,\n.field__hint {\n  grid-column: 1;',
    expect: 'A1④'
  },
  {
    id: 'A1-7',
    title: '把勾选框搬回标签列（去掉空占位、方框直接落在第 1 列）',
    file: FIELD_URL,
    from: '      <span class="field__label field__label--empty" aria-hidden="true"></span>\n      <div class="field__control">',
    to: '      <label class="check" :for="inputId"><input :id="inputId" type="checkbox" /></label>\n      <div class="field__control">',
    expect: 'A1⑤'
  },
  {
    id: 'A1-8',
    title: '拆掉窄窗口降级（删掉 568px 那条媒体查询的栅格覆盖）',
    file: CSS_URL,
    from: '@media (max-width: 568px) {\n  .field {\n    grid-template-columns: minmax(0, 1fr);\n  }',
    to: '@media (max-width: 568px) {\n  .field {\n    grid-template-columns: var(--label-w) minmax(0, 1fr);\n  }',
    expect: 'A1⑥'
  },
  {
    id: 'A1-9',
    title: '把嵌套栅格加回来（.field__row 包住标签与控件，控件列会塌成 0）',
    file: FIELD_URL,
    from: '  <div class="field" :class="{ \'field--full\': field.full }">\n',
    to: '  <div class="field" :class="{ \'field--full\': field.full }">\n    <div class="field__row">\n',
    expect: 'A1⑦'
  }
]

function runGates() {
  const target = fileURLToPath(new URL('test/formAlign.test.js', ROOT))
  try {
    const out = execFileSync(process.execPath, ['--test', target], {
      cwd: fileURLToPath(ROOT),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { ok: true, out }
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

const lines = []
const stamp = new Date().toISOString()
lines.push('# 「表单对齐」门禁变异自证（A1 系列）')
lines.push(`# 时间：${stamp}`)
lines.push('# 手法：每处变异只改一处字面（见 scripts/mutate-align-gates.mjs 的 MUTATIONS 表），')
lines.push('#       跑 test/formAlign.test.js 记录"哪条门禁变红"，随后按字节还原并复跑确认全绿。')
lines.push('')

const baseline = runGates()
lines.push(`## 基线（未变异）：${baseline.ok ? '全绿 ✔' : '红 ✘（基线就红，后续证据无效）'}`)
lines.push('')

let allGood = baseline.ok
for (const m of MUTATIONS) {
  const url = m.file
  const original = readFileSync(url, 'utf8')
  const hits = original.split(m.from).length - 1
  if (hits !== 1) {
    lines.push(`## ${m.id} ${m.title}`)
    lines.push(`  ✘ 变异锚点在源码里命中 ${hits} 次（应恰好 1 次）——证据无效`)
    lines.push('')
    allGood = false
    continue
  }
  writeFileSync(url, original.replace(m.from, m.to), 'utf8')
  const mutated = runGates()
  writeFileSync(url, original, 'utf8')
  const restored = runGates()

  const red = mutated.ok === false
  const redHasExpected = mutated.out.includes(m.expect)
  const green = restored.ok === true
  const passed = red && redHasExpected && green
  allGood = allGood && passed

  lines.push(`## ${m.id} ${m.title}`)
  lines.push(`  变异：${m.from.replace(/\n/g, ' ⏎ ')}`)
  lines.push(`     → ${m.to.replace(/\n/g, ' ⏎ ')}`)
  lines.push(`  变异后：${red ? '红 ✔' : '仍然全绿 ✘（这条门禁没拦住）'}`)
  lines.push(`  变红的门禁含 ${m.expect}：${redHasExpected ? '是 ✔' : '否 ✘'}`)
  const failedNames = [...mutated.out.matchAll(/^✖ (.+?) \(/gm)].map((x) => x[1].trim())
  lines.push(`  变红用例：${failedNames.length ? failedNames.join(' | ') : '(无)'}`)
  lines.push(`  还原后：${green ? '全绿 ✔' : '仍然红 ✘'}`)
  lines.push(`  判定：${passed ? 'PASS' : 'FAIL'}`)
  lines.push('')
}

lines.push(
  `## 总判定：${allGood ? '全部变异均被拦住且还原后全绿 ✔' : '存在未被拦住的变异或还原失败 ✘'}`
)
lines.push('')

const outFile = new URL('docs/evidence/align-mutation-A1-gates.txt', ROOT)
writeFileSync(outFile, lines.join('\n'), 'utf8')
process.stdout.write(lines.join('\n'))
process.stdout.write(`\n证据已写入 ${fileURLToPath(outFile)}\n`)
process.exitCode = allGood ? 0 : 1
