/**
 * 组件源码门禁（**读源码断言关键接线**，与宿主 `test/app-window-wiring.test.ts` 同款手法）。
 *
 * 为什么读源码而不是挂载组件：扩展没有 jsdom / @vue/test-utils，运行时渲染只覆盖了 SFC 的
 * "可见性过滤"那一小块（test/formState.test.js 的 R-D2-4）。而下面这些接线一旦被改回去，
 * 现有用例**全是绿的**——最典型的就是把 ConnectionModal 的表单改回
 * `const form = reactive(rowToForm(props.row))`（M1 的变异自证：81/81 全绿）。
 * 所以这里把"必须存在的接线"与"绝不能回来的写法"钉在源码文本上。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/** 去掉块注释 / HTML 注释 / 行注释，避免"文档里的示例字符串"把断言喂成假绿 */
function source(name) {
  return readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const MODAL = source('ConnectionModal.vue')
const FIELD = source('ConnectionField.vue')
const DELETE = source('DeleteConfirm.vue')

test('M1：ConnectionModal 的 form 必须由 props.row 经 watch 同步（不得回退成 reactive(rowToForm(...))）', () => {
  // 修复点 1：空壳 + watch 同步（props 是唯一真源）
  assert.ok(
    MODAL.includes('const form = reactive(defaultForm())'),
    'form 必须以空壳 defaultForm() 起手'
  )
  assert.ok(MODAL.includes('watch('), '必须用 watch 跟着 props.row 走')
  assert.ok(MODAL.includes('props.row'), 'watch 的源必须是 props.row')
  assert.ok(MODAL.includes('Object.assign(form, rowToForm(row))'), '每次都用 rowToForm 全量覆盖')
  assert.ok(MODAL.includes('delete form.id'), '新建时必须清掉残留 id，否则"新建"会被当成"更新"')
  // 修复点 2（回归模式）：不能把 rowToForm 的结果直接交给 reactive——
  // 那样"props 变化"就不再驱动表单，A 的残值会留在 B 上（R-D2-1 的根因）
  assert.ok(
    !/reactive\(\s*rowToForm\(/.test(MODAL),
    '不得写成 reactive(rowToForm(props.row))：表单会与后续 props 脱钩'
  )
  // 修复点 3：UI 显示与提交范围同源（都走 fields.js 的可见性入口）
  assert.ok(MODAL.includes('isFieldVisible'), '可见性必须复用 fields.js 的入口')
  assert.ok(MODAL.includes('visibleFields(group)'), '模板必须用 visibleFields(group) 过滤字段')
  assert.ok(MODAL.includes('v-for="field in visibleFields(group)"'), 'v-for 必须走过滤后的字段')
})

test('N5：两个模态框都不得用"点遮罩"或 Esc 关闭（只留按钮路径）', () => {
  for (const [name, src] of [
    ['ConnectionModal.vue', MODAL],
    ['DeleteConfirm.vue', DELETE]
  ]) {
    assert.ok(!src.includes('@mousedown.self'), `${name} 不得绑定遮罩点击关闭`)
    assert.ok(!src.includes('@click.self'), `${name} 不得绑定遮罩点击关闭`)
    assert.ok(!src.includes('Escape'), `${name} 不得响应 Esc 关闭`)
    assert.ok(!src.includes("addEventListener('keydown'"), `${name} 不得装 keydown 监听`)
  }
  // 按钮路径仍在（取消 / 关闭 / 保存）
  assert.ok(MODAL.includes('@click="emit(\'close\')"'), '「✕」「取消」按钮必须还在')
  assert.ok(DELETE.includes('@click="emit(\'close\')"'), '删除确认的「取消」必须还在')
  assert.ok(DELETE.includes('@click="emit(\'confirm\')"'), '删除确认的「删除」必须还在')
})

test('N2/N3/N4：多选一只有 select，取值说明进 option 文本，且不再有逐项说明行', () => {
  // N2：radio 分支与样式都删掉
  assert.ok(!FIELD.includes("type === 'radio'"), '控件层不得再有 radio 分支')
  assert.ok(!FIELD.includes('type="radio"'), '模板里不得再有 radio 输入')
  assert.ok(!FIELD.includes('radio-group'), '不得再有 radio 组')
  // N3：option 文本 = 取值 + 短说明；更细的一句放在 title 里
  assert.ok(FIELD.includes('{{ option.value }} — {{ option.label }}'), '选项文本必须带取值与短说明')
  assert.ok(FIELD.includes(':title="option.desc"'), '更细的说明放 option 的 title')
  assert.ok(!FIELD.includes('selectedOptionDesc'), '不得再有"当前选中取值"说明行')
  assert.ok(!FIELD.includes('radio__desc'), '不得再有逐项说明行')
  // M4：带 optional 的字段多一个"留空"选项，且空值必须原样传 ''（不能 Number('') 变 0）
  assert.ok(FIELD.includes('v-if="field.optional"'), 'optional 字段必须渲染空值选项')
  assert.ok(FIELD.includes('field.emptyLabel'), '空值选项的文案来自字段定义')
  assert.ok(
    /raw === '' \? '' : Number\(raw\)/.test(FIELD),
    '空值选项必须传 ""，不能 Number("") 变成合法的 0'
  )
  // badge（"未官方确认"角标）已删除
  assert.ok(!FIELD.includes('badge'), '不得再有 badge 角标渲染')
})

test('N1：主题桥必须在 mount 之前装上（首帧就有兜底配色）', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const installAt = main.indexOf('installThemeBridge()')
  const mountAt = main.indexOf('createApp(App).mount(')
  assert.ok(installAt >= 0 && mountAt >= 0, 'main.js 必须既装主题桥又挂载应用')
  assert.ok(installAt < mountAt, 'installThemeBridge() 必须早于 mount（顺序不能反）')
})

test('P1：密码框的「显示/隐藏」切换必须在控件层，且默认是掩码', () => {
  // 眼睛按钮已存在（本次需求只要求"确认它在回填后仍工作"），把它钉在源码上：
  assert.ok(
    FIELD.includes('const passwordVisible = ref(false)'),
    '密码可见性初值必须是 false（默认掩码）'
  )
  assert.ok(
    FIELD.includes(":type=\"passwordVisible ? 'text' : 'password'\""),
    '切换只能改 type（password ↔ text），不得换成别的渲染方式'
  )
  assert.ok(
    FIELD.includes('@click="passwordVisible = !passwordVisible"'),
    '必须有一个切换按钮（眼睛）'
  )
  assert.ok(
    FIELD.includes("passwordVisible ? '隐藏密码' : '显示密码'"),
    '按钮要有无障碍名（显示/隐藏密码）'
  )
  assert.ok(FIELD.includes(':aria-pressed="passwordVisible"'), '按钮要报告按下态')
  assert.ok(
    FIELD.includes(':value="form[field.key]"'),
    '输入框必须绑表单值——回填后（form.password 有值）才能显示出来'
  )
})

test('P2：密码回填只在编辑路径发生，且注入点在 rowToForm 之后', () => {
  const rowToFormAt = MODAL.indexOf('Object.assign(form, rowToForm(row))')
  const requestAt = MODAL.indexOf("callExtension('password'")
  const injectAt = MODAL.indexOf('form.password = storedPassword')
  assert.ok(rowToFormAt >= 0, 'rowToForm 的同步必须还在（props 是唯一真源）')
  assert.ok(requestAt > rowToFormAt, '取密码必须发生在 rowToForm 之后（先铺表单，再补密码）')
  assert.ok(injectAt > requestAt, '注入点必须在取回之后')
  // 新建（无 id）必须**早于**请求就返回：`delete form.id` 必须排在请求之前
  const createAt = MODAL.indexOf('delete form.id')
  assert.ok(
    createAt >= 0 && createAt < requestAt,
    '新建路径必须在请求密码之前返回（新建不请求密码）'
  )
  assert.ok(
    MODAL.includes("if (id === undefined || id === null || id === '')"),
    '必须有"无 id ⇒ 新建"的分支守卫'
  )
  // 回填值必须传给 buildSavePayload，否则"清空即删除"无从与"没动"区分
  assert.ok(
    MODAL.includes('buildSavePayload(form, { storedPassword })'),
    '打开时读到的原值必须交给 buildSavePayload（区分没动 / 清空）'
  )
  assert.ok(MODAL.includes('callExtension'), '模态框必须经 bridge 调扩展（页面里没有 api 对象）')
})
