/**
 * R-D2 复现测试（设计文档 §3.1）：5 个用例 + 1 条「路径无关性」属性测试（§3.2 分支 C 的判定器）。
 *
 * 运行：cd extensions/rdp && node --test test/formState.test.js
 * 先红后修的证据：`tmp/rdp-d2-before.txt`（未改任何源码时）→ `tmp/rdp-d2-after.txt`（按 §3.3 修法 1→3→2 修复后）。
 *
 * 用例 (d) 是渲染层用例：用 `@vue/compiler-sfc` 编译一份**最小 SFC**（复刻 ConnectionModal.vue 的
 * `v-for` + 可见性过滤 + `:key` 结构）再用 `vue/server-renderer` 渲染，两个模块均已随 `vue` 可解析，
 * **不新增任何依赖**（扩展也没有 @vue/test-utils / jsdom）。
 *
 * 引用方式（M1 修掉失效行号后）：**按符号引用**，不再写 `ConnectionModal.vue:122-130` 这类行号——
 * 组件一改行号就漂，源码门禁在 test/componentSource.test.js 里单独钉（`watch(` + `props.row`、
 * 不得出现 `reactive(rowToForm(props.row))`、模板必须用 `visibleFields(group)`）。
 */
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { fromDbRow, normalizeConnection, toDbRow } from '../lib/connection.mjs'
import { buildRdpText } from '../lib/rdpFile.mjs'
import {
  ALL_FIELDS,
  COMMON_GROUPS,
  buildSavePayload,
  defaultForm,
  rowToForm,
  visibleFieldKeys
} from '../src/fields.js'

/* ---------- 公共工具 ---------- */

/** 表单值 → 布尔（0/1/'1'/true 都算真，与 fields.js 的口径一致） */
function truthy(value) {
  return value === true || value === 1 || value === '1'
}

/** 表单 → 载荷 → **扩展真实保存链路**（normalizeConnection → toDbRow → fromDbRow）→ 回读表单 */
function saveAndReopen(form) {
  const payload = buildSavePayload(form)
  const row = fromDbRow(toDbRow(payload))
  return { payload, row, reopened: rowToForm(row) }
}

const ALL_FORM_KEYS = ALL_FIELDS.flatMap((f) => (Array.isArray(f.keys) ? f.keys : [f.key]))

/** key → { field, pairKey }，供属性测试翻转任意一个表单键 */
const KEY_SPEC = new Map()
for (const field of ALL_FIELDS) {
  if (Array.isArray(field.keys))
    for (const key of field.keys) KEY_SPEC.set(key, { field, pairKey: true })
  else KEY_SPEC.set(field.key, { field, pairKey: false })
}

/** 把某个表单键换成"另一个合法取值"（属性测试用；不追求语义，只求与旧值不同） */
function flipValue(key, value) {
  const { field, pairKey } = KEY_SPEC.get(key)
  if (pairKey || field.type === 'number') return Number(value || 0) + 7
  if (field.type === 'check') return !truthy(value)
  if (field.type === 'select') {
    const other = field.options.find((option) => option.value !== value)
    return other ? other.value : value
  }
  return value === 'RDP-FLIP' ? '' : 'RDP-FLIP'
}

/* ---------- 渲染层工具（最小 SFC + SSR） ---------- */

/** 复刻 ConnectionModal.vue 的 `visibleFields(group)` + `v-for` + `:key="field.key"` 结构
 *  （按符号引用，不写行号——行号由 test/componentSource.test.js 的门禁兜底）
 *  复用 fields.js 的可见性入口（修法 3：UI 显示与提交范围同源）。 */
const MODAL_LIKE_SFC = `<script setup>
import { isFieldVisible } from '../../src/fields.js'

const props = defineProps({
  form: { type: Object, required: true },
  groups: { type: Array, required: true }
})

function visibleFields(group) {
  return group.fields.filter((field) => isFieldVisible(field, props.form))
}
</script>
<template>
  <div class="form-rows">
    <section v-for="group in groups" :key="group.title" class="form-group">
      <div v-for="field in visibleFields(group)" :key="field.key" class="field">
        <label v-if="field.type === 'check'" class="check">
          <input :id="'rdp-field-' + field.key" type="checkbox" :checked="!!form[field.key]" />
          <span>{{ field.label }}</span>
        </label>
        <span v-else class="field__label">{{ field.label }}</span>
      </div>
    </section>
  </div>
</template>
`

const SFC_TMP_DIR = join(import.meta.dirname, '.tmp-sfc')

/** 编译一份 SFC 源码 → 落成临时 mjs（同目录相对导入才能解析）→ 动态 import → 返回组件 */
async function loadSfc(source, id) {
  const { descriptor, errors } = parse(source, { filename: `${id}.vue` })
  assert.equal(errors.length, 0, `SFC 解析失败：${errors[0]?.message}`)
  const compiled = compileScript(descriptor, { id, inlineTemplate: true })
  mkdirSync(SFC_TMP_DIR, { recursive: true })
  const file = join(SFC_TMP_DIR, `${id}.mjs`)
  writeFileSync(file, compiled.content, 'utf8')
  try {
    return (await import(pathToFileURL(file).href)).default
  } finally {
    // 编译产物只服务本次 import（模块已进缓存），立刻删掉，别留给 prettier / 打包
    rmSync(file, { force: true })
    rmSync(SFC_TMP_DIR, { recursive: true, force: true })
  }
}

/** 用一份表单值把组件 SSR 成 HTML（每次都是全新 app，等价于"重新打开表单"） */
async function renderForm(component, form) {
  return await renderToString(createSSRApp(component, { form, groups: COMMON_GROUPS }))
}

/** HTML 里某个复选框的勾选态；该项未渲染时返回 null */
function checkboxOf(html, key) {
  const tag = html.match(new RegExp(`<input[^>]*id="rdp-field-${key}"[^>]*>`))
  if (!tag) return null
  return /\schecked(=|>|\s)/.test(tag[0])
}

/* ---------- R-D2-1 ---------- */

test('R-D2-1 编辑 A 保存后再编辑 B 不残留 A 的值', () => {
  const rowA = {
    id: 1,
    name: 'A',
    host: 'a.example',
    port: 13389,
    username: 'ua',
    domain: 'DA',
    desktopWidth: 1024,
    desktopHeight: 768,
    audioMode: 1,
    keyboardHook: 0,
    authenticationLevel: 1,
    gatewayHostname: 'gw',
    gatewayUsageMethod: 2,
    sessionBpp: 8,
    clipboard: false
  }
  const rowB = {
    id: 2,
    name: 'B',
    host: 'b.example',
    port: 3389,
    username: 'ub',
    audioMode: 2,
    keyboardHook: 1,
    authenticationLevel: 3,
    desktopWidth: 1920,
    desktopHeight: 1080
  }

  // 「编辑 A → 保存」走完整保存链路，再打开 B
  saveAndReopen(rowToForm(rowA))
  const formB = rowToForm(rowB)

  // B 的表单必须逐 key 只由 rowB 决定（这里逐字段独立断言，而不是复述 `{...defaultForm(), ...rowB}`
  // 那句恒真式：`rowToForm` 一旦漏归一化某个类型，下面几条会红）。
  const defaultsB = defaultForm()
  assert.equal(formB.id, 2, 'id 必须带过来')
  assert.equal(formB.name, 'B')
  assert.equal(formB.host, 'b.example')
  assert.equal(formB.port, 3389)
  assert.equal(formB.username, 'ub')
  assert.equal(formB.password, '', '密码永不进表单（只在 api.secrets）')
  // rowB 没给的键一律回落 defaultForm()（逐 key 覆盖，不是"整份深比较"）
  for (const key of ALL_FORM_KEYS) {
    const fromRow = rowB[key]
    if (fromRow === undefined) assert.deepEqual(formB[key], defaultsB[key], `${key} 应回落默认`)
  }
  assert.equal(formB.desktopWidth, 1920, 'rowB 给了的键取 rowB')
  assert.equal(formB.audioMode, 2)
  assert.equal(formB.authenticationLevel, 3)
  // rowToForm 必须**每次都产出完整表单**（ConnectionModal 靠 Object.assign 覆盖，缺 key 会留残值）
  assert.deepEqual(Object.keys(formB).sort(), [...ALL_FORM_KEYS, 'id'].sort())
  // A 的特征值一个都不许出现
  assert.notEqual(formB.desktopWidth, 1024)
  assert.notEqual(formB.audioMode, 1)
  assert.notEqual(formB.keyboardHook, 0)
  assert.notEqual(formB.authenticationLevel, 1)
  assert.notEqual(formB.gatewayUsageMethod, 2)
  assert.notEqual(formB.username, 'ua')
})

/* ---------- R-D2-2 ---------- */

test('R-D2-2 新建→保存→再新建须回到默认值', () => {
  const first = defaultForm()
  const snapshot = JSON.stringify(first)

  // ① 「新建」的真实入口是父级把 `row` 置回 null（App.vue 的 openCreate）——
  //    所以这里比的是两条**跨路径**的结果，而不是 `defaultForm() === defaultForm()` 这种恒真式。
  assert.deepEqual(rowToForm(null), first, '新建（row=null）必须是纯默认值')
  const emptyRow = rowToForm({})
  const { id: emptyRowId, ...emptyRest } = emptyRow
  assert.equal(emptyRowId, undefined, '空 row 不该造出 id')
  assert.deepEqual(emptyRest, first, '新建（空 row）除 id 外必须与默认值逐 key 相同')

  // ② 存过一条"改花了的"连接后，再新建**不得残留它的任何一个值**
  const edited = {
    ...first,
    name: '新建A',
    host: '10.0.0.9',
    fullscreen: true,
    multimon: true,
    clipboard: false,
    sessionBpp: 8,
    driveStoreDirect: 'C:\\;'
  }
  const { payload, reopened } = saveAndReopen(edited)
  assert.equal(payload.name, '新建A')
  assert.equal(payload.sessionBpp, 8)
  assert.equal(reopened.driveStoreDirect, 'C:\\;')

  const second = rowToForm(null)
  assert.deepEqual(second, first)
  assert.equal(JSON.stringify(second), snapshot)
  assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort())
  for (const key of ['name', 'host', 'fullscreen', 'multimon', 'sessionBpp', 'driveStoreDirect']) {
    assert.deepEqual(second[key], first[key], `${key} 不得残留上一条连接的值`)
  }
  assert.notEqual(second.name, '新建A')
})

/* ---------- R-D2-3 ---------- */

test('R-D2-3 隐藏字段不得携带旧值 / 不影响相邻字段', () => {
  const base = { ...defaultForm(), name: 'GW', host: 'gw.example' }
  const def = defaultForm()

  // ① 填网关地址 → 网关三项可见；清空网关地址 → 三项隐藏
  const withGateway = { ...base, gatewayHostname: 'gw.example', gatewayUsageMethod: 1 }
  assert.equal(buildSavePayload(withGateway).gatewayUsageMethod, 1, '可见时应提交用户选的值')
  const payload = buildSavePayload({ ...withGateway, gatewayHostname: '' })
  assert.equal(payload.gatewayUsageMethod, def.gatewayUsageMethod, '隐藏后不得提交历史值')
  assert.equal(payload.gatewayCredentialsSource, def.gatewayCredentialsSource)
  assert.equal(payload.promptCredentialOnce, def.promptCredentialOnce ? 1 : 0)

  // ② 保存后回读：屏幕上没有的值不得进库 —— 否则再次填网关地址就会"选项错乱"
  const { reopened } = saveAndReopen({ ...withGateway, gatewayHostname: '' })
  assert.equal(reopened.gatewayUsageMethod, def.gatewayUsageMethod)
  assert.notEqual(reopened.gatewayUsageMethod, 1)
  assert.equal(
    { ...reopened, gatewayHostname: 'gw2.example' }.gatewayUsageMethod,
    def.gatewayUsageMethod,
    '重新可见时必须是默认值，而不是上一次留下的历史值'
  )

  // ③ singleMonInWindowedMode（M3 的行为变更）：
  //    R-D2 修复 key 拼写后它一度"恒隐藏"（用户看不到入口）；现在按官方语义在**窗口模式**下显示，
  //    全屏时隐藏 → 隐藏则回填默认 0，可见则照常提交用户值。
  const windowedSingle = buildSavePayload({
    ...base,
    fullscreen: false,
    singleMonInWindowedMode: true
  })
  assert.equal(windowedSingle.singleMonInWindowedMode, 1, '窗口模式下可见 → 提交用户值')
  const fullscreenSingle = buildSavePayload({
    ...base,
    fullscreen: true,
    singleMonInWindowedMode: true
  })
  assert.equal(fullscreenSingle.singleMonInWindowedMode, 0, '全屏时隐藏 → 按默认值回填 0')

  // ④ fullscreen 开→关：期间隐藏的四项不得提交旧值
  const fullscreenForm = {
    ...base,
    fullscreen: true,
    multimon: true,
    selectedMonitors: '1,2',
    desktopWidth: 9999,
    desktopHeight: 9999,
    smartSizing: false,
    dynamicResolution: false
  }
  const fullscreenPayload = buildSavePayload(fullscreenForm)
  assert.equal(fullscreenPayload.desktopWidth, 1280, '全屏时「分辨率」隐藏 → 回填默认')
  assert.equal(fullscreenPayload.desktopHeight, 800)
  assert.equal(fullscreenPayload.smartSizing, 1)
  assert.equal(fullscreenPayload.dynamicResolution, 1)
  assert.equal(
    fullscreenPayload.selectedMonitors,
    '1,2',
    '全屏 + 多显时「指定显示器」可见，照常提交'
  )

  // ⑤ 重新可见后，值与元素都按**当前表单**提交，不受隐藏期间的历史影响
  const windowed = {
    ...fullscreenForm,
    fullscreen: false,
    desktopWidth: 1024,
    desktopHeight: 768,
    smartSizing: false,
    dynamicResolution: true
  }
  const windowedPayload = buildSavePayload(windowed)
  assert.equal(windowedPayload.desktopWidth, 1024)
  assert.equal(windowedPayload.desktopHeight, 768)
  assert.equal(windowedPayload.smartSizing, 0)
  assert.equal(windowedPayload.dynamicResolution, 1)
  assert.equal(windowedPayload.multimon, 0, '窗口模式下「多显示器」隐藏 → 不得提交 true')
  assert.equal(windowedPayload.selectedMonitors, '', '窗口模式下「指定显示器」隐藏 → 回到默认')

  // ⑥ 边界（设计 §7.1 对 rdpFile.test.js 的提醒）：隐藏字段回填默认值后，写出的 .rdp 也是默认值
  const rdpText = buildRdpText(normalizeConnection(payload))
  assert.ok(
    !rdpText.includes('gatewayusagemethod'),
    '.rdp 不该出现用户看不见的历史网关用法（等于默认值时本就省略）'
  )
  assert.ok(!rdpText.includes('promptcredentialonce:i:0'), '网关共用凭据回到默认 1 → 不写 0')
  assert.ok(
    rdpText.includes('singlemoninwindowedmode:i:0\r\n'),
    '窗口模式下「窗口模式单显」可见（默认关）→ 布尔项显式写 0'
  )
})

/* ---------- R-D2-4（渲染层） ---------- */

test('R-D2-4 可见性过滤变化后，重新出现的复选框不沿用上一次的 DOM 状态', async () => {
  const ModalLike = await loadSfc(MODAL_LIKE_SFC, 'rdp-modal-like')
  const base = { ...defaultForm(), name: 'R', host: 'r.example' }

  const windowed = { ...base, fullscreen: false, multimon: false, clipboard: false }
  const fullscreenOff = { ...base, fullscreen: true, multimon: false, clipboard: true }
  const fullscreenOn = { ...base, fullscreen: true, multimon: true, clipboard: true }

  const htmlWindowed = await renderForm(ModalLike, windowed)
  const htmlFullscreenOff = await renderForm(ModalLike, fullscreenOff)
  const htmlFullscreenOn = await renderForm(ModalLike, fullscreenOn)

  // ① 过滤生效：窗口模式看得到分辨率/智能缩放/动态分辨率，看不到「多显示器」
  for (const label of ['分辨率', '智能缩放', '动态分辨率']) {
    assert.ok(htmlWindowed.includes(label), `窗口模式应显示「${label}」`)
    assert.ok(!htmlFullscreenOff.includes(label), `全屏时不应显示「${label}」`)
  }
  assert.equal(checkboxOf(htmlWindowed, 'multimon'), null, '窗口模式下「多显示器」整项不渲染')
  assert.ok(htmlFullscreenOff.includes('多显示器'), '全屏时「多显示器」应重新出现')

  // ② 重新出现的复选框必须用**当前表单**的值，不沿用上一次渲染的状态
  assert.equal(checkboxOf(htmlWindowed, 'fullscreen'), false)
  assert.equal(checkboxOf(htmlWindowed, 'multimon'), null)
  assert.equal(checkboxOf(htmlWindowed, 'clipboard'), false)
  assert.equal(checkboxOf(htmlFullscreenOff, 'multimon'), false)
  assert.equal(checkboxOf(htmlFullscreenOn, 'multimon'), true)
  assert.equal(checkboxOf(htmlFullscreenOn, 'fullscreen'), true)
  assert.equal(checkboxOf(htmlFullscreenOn, 'clipboard'), true)

  // ③ 同一份表单重复渲染必须逐字节一致（渲染不携带隐含状态）
  assert.equal(await renderForm(ModalLike, fullscreenOn), htmlFullscreenOn)
})

/* ---------- R-D2-5（守卫） ---------- */

test('R-D2-5 VISIBILITY 规则不得泄漏到字段对象（不得就地挂载 showIf）', async () => {
  // 只有字段字面量自带的 showIf 允许存在（当前仅 multimon）；VISIBILITY 不得就地改写模块级字段单例
  const withRule = ALL_FIELDS.filter((f) => typeof f.showIf === 'function').map((f) => f.key)
  assert.deepEqual(withRule, ['multimon'], 'VISIBILITY 不得就地挂载到字段对象上')

  for (const key of [
    'smartSizing',
    'dynamicResolution',
    'desktopWidth',
    'desktopHeight',
    'selectedMonitors',
    'maximizeToCurrentDisplays',
    'singleMonInWindowedMode',
    'gatewayUsageMethod',
    'gatewayCredentialsSource',
    'promptCredentialOnce',
    'adminSession',
    'username',
    'domain',
    'password',
    'remember',
    'remoteApplicationProgram'
  ]) {
    // 成对字段（分辨率）的 key 不在 FIELD_BY_KEY 里，落到它所属的字段对象上
    const owner = KEY_SPEC.get(key).field
    assert.equal(owner.showIf, undefined, `${key} 不应被就地挂载 showIf`)
  }

  // 但可见性判定必须仍然生效，且**只有一处入口**（修法 3：UI 显示与提交范围同源）
  const fields = await import('../src/fields.js')
  assert.equal(
    typeof fields.visibleFieldKeys,
    'function',
    '可见性判定必须上移为 fields.js 的纯函数 visibleFieldKeys(form)'
  )
  const fullscreen = fields.visibleFieldKeys({ ...defaultForm(), fullscreen: true, multimon: true })
  assert.ok(fullscreen.has('multimon'))
  assert.ok(fullscreen.has('selectedMonitors'))
  assert.ok(!fullscreen.has('desktopWidth'))
  assert.ok(!fullscreen.has('desktopHeight'))
  assert.ok(!fullscreen.has('smartSizing'))
  assert.ok(!fullscreen.has('dynamicResolution'))
  const entra = fields.visibleFieldKeys({ ...defaultForm(), enableRdsAadAuth: true })
  assert.ok(!entra.has('username'))
  assert.ok(!entra.has('domain'))
  assert.ok(!entra.has('remember'))
  // M3：窗口模式（默认 fullscreen=false）下必须**可见**；全屏时才隐藏
  assert.ok(fields.visibleFieldKeys(defaultForm()).has('singleMonInWindowedMode'))
  assert.ok(
    !fields.visibleFieldKeys({ ...defaultForm(), fullscreen: true }).has('singleMonInWindowedMode')
  )
  // L2：`multimon` 的自带 showIf 与 VISIBILITY 用**同一套 truthy 口径**（'1'/1/true 都算真）
  for (const on of [true, 1, '1']) {
    assert.ok(
      fields.visibleFieldKeys({ ...defaultForm(), fullscreen: on }).has('multimon'),
      `fullscreen=${JSON.stringify(on)} 时「多显示器」应可见`
    )
  }
  assert.ok(!fields.visibleFieldKeys({ ...defaultForm(), fullscreen: '0' }).has('multimon'))
})

/* ---------- R-D2-6（判定器：属性测试） ---------- */

const GATEWAY_HIDDEN = ['gatewayUsageMethod', 'gatewayCredentialsSource', 'promptCredentialOnce']
const REMOTE_APP_HIDDEN = [
  'remoteApplicationProgram',
  'remoteApplicationName',
  'remoteApplicationCmdLine',
  'remoteApplicationFile',
  'remoteApplicationIcon',
  'remoteApplicationGuid',
  'remoteApplicationExpandCmdLine',
  'remoteApplicationExpandWorkingDir'
]
const MULTIMON_ONLY_HIDDEN = ['selectedMonitors', 'maximizeToCurrentDisplays']
/** `multimon` 自带 showIf（只在全屏下显示）⇒ 窗口模式下也属于"屏幕上不存在" */
const MULTIMON_SELF_HIDDEN = ['multimon']
/** 只有**全屏**时才隐藏：M3 把它改成"窗口模式可见"（描述的是退出全屏后的行为） */
const FULLSCREEN_ONLY_HIDDEN = ['singleMonInWindowedMode']

const SCENARIOS = [
  {
    title: '窗口模式（fullscreen=false）',
    form: { fullscreen: false },
    hidden: [
      ...MULTIMON_SELF_HIDDEN,
      ...GATEWAY_HIDDEN,
      ...REMOTE_APP_HIDDEN,
      ...MULTIMON_ONLY_HIDDEN
    ]
  },
  {
    title: '全屏但不跨屏（fullscreen=true, multimon=false）',
    form: { fullscreen: true, multimon: false },
    hidden: [
      'desktopWidth',
      'desktopHeight',
      'smartSizing',
      'dynamicResolution',
      ...GATEWAY_HIDDEN,
      ...REMOTE_APP_HIDDEN,
      ...MULTIMON_ONLY_HIDDEN,
      ...FULLSCREEN_ONLY_HIDDEN
    ]
  },
  {
    title: 'Entra ID 认证开启（enableRdsAadAuth=true）',
    form: { enableRdsAadAuth: true },
    hidden: [
      'username',
      'domain',
      'remember',
      // 密码也是"屏幕上不存在"的一项：`buildSavePayload` 对 secret 单列了一条可见性判断
      // （否则开了 Entra 认证后，用户看不到的旧密码仍会被提交进 secrets/cmdkey）
      'password',
      ...MULTIMON_SELF_HIDDEN,
      ...GATEWAY_HIDDEN,
      ...REMOTE_APP_HIDDEN,
      ...MULTIMON_ONLY_HIDDEN
    ]
  },
  {
    title: 'RemoteApp 模式开启（remoteApplicationMode=true）',
    form: { remoteApplicationMode: true },
    hidden: ['adminSession', ...MULTIMON_SELF_HIDDEN, ...GATEWAY_HIDDEN, ...MULTIMON_ONLY_HIDDEN]
  }
]

/** 确定性伪随机（可复现，便于把红/绿输出留在证据文件里） */
function lcg(seed) {
  let state = seed >>> 0
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32
}

test('R-D2-6 判定器：同一份「屏幕上可见的表单值」经不同路径必须得到逐字节相同的 payload', () => {
  for (const scenario of SCENARIOS) {
    // "屏幕上完全一样"的那部分表单值（可见字段固定为默认值 + 场景前提）
    const visibleForm = {
      ...defaultForm(),
      name: 'P',
      host: 'p.example',
      port: 3389,
      ...scenario.form
    }
    const hidden = new Set(scenario.hidden)

    // ⓪ L1：hidden 清单**必须与 visibleFieldKeys 的口径逐项一致**（不允许再出现"清单写过时了"）——
    //    清单是"手写期望值"，这一条把它和"实现算出来的可见集"钉在一起。
    const computedHidden = ALL_FORM_KEYS.filter(
      (key) => !visibleFieldKeys(visibleForm).has(key)
    ).sort()
    assert.deepEqual(
      [...hidden].sort(),
      computedHidden,
      `${scenario.title}：hidden 清单与 visibleFieldKeys 算出的隐藏集不一致`
    )

    // ① 隐藏字段随便怎么变（模拟"上一轮留下的历史值"）→ payload 必须逐字节相同
    const random = lcg(0x9e3779b9)
    for (let round = 0; round < 40; round++) {
      const stable = { ...visibleForm }
      const history = { ...visibleForm }
      const changed = []
      for (const key of scenario.hidden) {
        const def = defaultForm()[key]
        stable[key] = def
        if (random() < 0.5) {
          history[key] = flipValue(key, def)
          changed.push(key)
        } else history[key] = def
      }
      assert.equal(
        JSON.stringify(buildSavePayload(history)),
        JSON.stringify(buildSavePayload(stable)),
        `${scenario.title}：第 ${round} 轮隐藏字段（${changed.join(',') || '无'}）的历史值改变了 payload`
      )
    }

    // ② 反向自检：可见字段一变，payload 必须变（证明上面的 hidden 清单没写错）
    const visibleKeys = ALL_FORM_KEYS.filter((key) => !hidden.has(key) && key !== 'password')
    assert.ok(visibleKeys.length > 5, `${scenario.title}：可见字段数量异常`)
    for (const key of visibleKeys) {
      const before = { ...visibleForm }
      const after = { ...visibleForm, [key]: flipValue(key, before[key]) }
      assert.ok(
        JSON.stringify(buildSavePayload(before)) !== JSON.stringify(buildSavePayload(after)),
        `${scenario.title}：可见字段 ${key} 变化后 payload 未变（hidden 清单可能写错）`
      )
    }
  }
})
