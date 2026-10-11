/**
 * R-D3 说明文本门禁（设计 §7.1 的 4 个用例，R-D4 起按"下拉框 + 一行说明"重算口径）。
 *
 * 三层：
 *   ① 覆盖率：65 个字段、**26 个官方取值**（6 个带 options 的字段）必须有非空 desc/label；
 *   ② 单行约束：字段 desc ≤ 48 字、取值 label ≤ 20 字、取值 desc ≤ 30 字（R-D4 的"最多一行、尽量简短"）；
 *   ③ 确证状态：占位文本（"待确认：…"）的清单必须与登记表一致——本次 5 条待确认
 *      （4 个字段 + `keyboardHook=3`）**已按微软官方文档全部确证**，故清单为空；
 *      `OFFICIALLY_CONFIRMED` 里逐条记来源 URL 与确证日期，任何新增"待确认"都必须先改这张表。
 *
 * 计数口径（R-D4）：`OPTION_COUNT` **只数 `options[]` 里的官方取值**；
 * 带 `optional` 的字段（`gatewayCredentialsSource`）在下拉框最前面那个"留空（不写该键）"选项
 * 由 `ConnectionField.vue` 渲染，**不在 `options` 里**（它是"空值态"，不是官方枚举值）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ADVANCED_GROUPS, ALL_FIELDS, COMMON_GROUPS } from '../src/fields.js'

/** 官方确证登记表（设计 §15 的 K1–K5）。改这里等于声明"又确证/新发现了一条待确认"。 */
const OFFICIALLY_CONFIRMED = {
  singleMonInWindowedMode: {
    kind: 'field',
    source:
      'https://learn.microsoft.com/en-us/azure/virtual-desktop/rdp-properties（singlemoninwindowedmode：0 退出全屏保留全部显示器 / 1 切回单显示器，需 use multimon=1）',
    date: '2026-10-11'
  },
  gatewayCredentialsSource: {
    kind: 'field',
    source:
      'https://github.com/MicrosoftDocs/windowsserverdocs/blob/92e46b11154bab929e2c622d759ef62ec264c4e6/WindowsServerDocs/remote/remote-desktop-services/clients/rdp-files.md（官方 RDS 设置表：gatewaycredentialssource 取 0–5；由 PR #4510 合入）',
    date: '2026-10-11'
  },
  usbDeviceStoreDirect: {
    kind: 'field',
    source:
      'https://learn.microsoft.com/en-us/azure/virtual-desktop/rdp-properties（usbdevicestoredirect：* / {设备安装类 GUID} / USB 实例 ID）',
    date: '2026-10-11'
  },
  cameraStoreDirect: {
    kind: 'field',
    source:
      'https://learn.microsoft.com/en-us/azure/virtual-desktop/rdp-properties（camerastoredirect：* / 设备实例路径列表 / 前缀 - 表示排除）',
    date: '2026-10-11'
  },
  'keyboardHook=3': {
    kind: 'option',
    // B2 复盘：2026-10-11 逐字回读该页（Last updated 2026-05-16），keyboardhook 一栏**确有 3**：
    //   「1: (Desktop sessions only) Windows key combinations are applied on the remote computer when
    //     in focus. / 3: (RemoteApp sessions only) ... applied on the RemoteApp when in focus ... only
    //     supported when using the Windows client.」，官方默认 2。
    // 同时确认：**旧版**《Supported Remote Desktop RDP file settings》
    // （MicrosoftDocs/windowsserverdocs 的 rdp-files.md，ms.date 2020-09-14）只列 0/1/2——
    // 上一轮"来源页不含 3"的判断来自那一版（/windows-server/.../rdp-files 现在 302 到同一页）。
    source:
      'https://learn.microsoft.com/en-us/azure/virtual-desktop/rdp-properties（keyboardhook：1 = "(Desktop sessions only) … when in focus"；3 = "(RemoteApp sessions only) … applied on the RemoteApp when in focus"，官方默认 2；2026-10-11 回读确证。旧版 rdp-files 表只列 0/1/2，故此前疑似悬空）',
    date: '2026-10-11'
  }
}

/** 每个字段的「所属分组 + 位置」，便于报错定位 */
const FIELD_INDEX = [
  ...COMMON_GROUPS.map((group) => ({ group: `常用/${group.title}`, fields: group.fields })),
  ...ADVANCED_GROUPS.map((group) => ({ group: `高级/${group.title}`, fields: group.fields }))
].flatMap((entry) => entry.fields.map((field) => ({ ...entry, field })))

/** 带 options 的字段（全部是 select，R-D4 起不再有 radio）与它们的官方取值总数 */
const OPTION_FIELDS = ALL_FIELDS.filter((field) => Array.isArray(field.options))
const OPTION_COUNT = OPTION_FIELDS.reduce((sum, field) => sum + field.options.length, 0)

/** 单行约束（R-D4）：按 640px 面板 / 12px 灰字 ≈ 50 字一行，留 2 字余量 */
const MAX_FIELD_DESC = 48
const MAX_OPTION_LABEL = 20
const MAX_OPTION_DESC = 30

/** 占位文本的判定口径：设计 §5.3 / §6.4 的"显式占位"以「待确认」开头 */
const isPlaceholder = (text) =>
  String(text ?? '')
    .trim()
    .startsWith('待确认')

const lengthOf = (text) => [...String(text ?? '')].length

test('每个字段都有 desc 且非空（覆盖率 65/65）', () => {
  assert.equal(ALL_FIELDS.length, 65, '字段总数应为 65（常用 19 + 高级 46）')
  const missing = FIELD_INDEX.filter(({ field }) => !String(field.desc ?? '').trim()).map(
    ({ group, field }) => `${group}/${field.key}`
  )
  assert.deepEqual(missing, [])
  // 数字对齐：常用 19 + 高级 46
  const common = COMMON_GROUPS.reduce((sum, group) => sum + group.fields.length, 0)
  assert.equal(common, 19)
  assert.equal(ALL_FIELDS.length - common, 46)
})

test('每个 select 的每个官方取值都有 label + desc（覆盖率 26/26、6 个字段）', () => {
  assert.equal(OPTION_FIELDS.length, 6, '带 options 的字段应为 6 个')
  assert.equal(OPTION_COUNT, 26, '官方取值总数应为 26（3+4+4+4+5+6）')
  assert.deepEqual(
    OPTION_FIELDS.map((field) => [field.key, field.options.length]),
    [
      ['audioMode', 3],
      ['keyboardHook', 4],
      ['authenticationLevel', 4],
      ['sessionBpp', 4],
      ['gatewayUsageMethod', 5],
      ['gatewayCredentialsSource', 6]
    ]
  )
  const missing = []
  for (const field of OPTION_FIELDS) {
    for (const option of field.options) {
      if (!String(option.label ?? '').trim()) missing.push(`${field.key}=${option.value}:label`)
      if (!String(option.desc ?? '').trim()) missing.push(`${field.key}=${option.value}:desc`)
    }
  }
  assert.deepEqual(missing, [])
  // 多选一的控件一律是 select；radio 与"未官方确认"角标都已删除
  assert.deepEqual(
    ALL_FIELDS.filter((field) => field.type === 'radio').map((field) => field.key),
    []
  )
  assert.deepEqual(
    [...ALL_FIELDS, ...OPTION_FIELDS.flatMap((f) => f.options)]
      .filter((item) => item.badge !== undefined)
      .map((item) => item.key ?? item.value),
    []
  )
})

test('说明文本都压在一行内（R-D4：字段 desc / 取值 label / 取值 desc 逐条限长）', () => {
  const tooLong = []
  for (const field of ALL_FIELDS) {
    if (lengthOf(field.desc) > MAX_FIELD_DESC)
      tooLong.push(`${field.key}:desc=${lengthOf(field.desc)}`)
    if (field.hint !== undefined && lengthOf(field.hint) > MAX_FIELD_DESC)
      tooLong.push(`${field.key}:hint=${lengthOf(field.hint)}`)
    for (const option of field.options ?? []) {
      if (lengthOf(option.label) > MAX_OPTION_LABEL)
        tooLong.push(`${field.key}=${option.value}:label=${lengthOf(option.label)}`)
      if (lengthOf(option.desc) > MAX_OPTION_DESC)
        tooLong.push(`${field.key}=${option.value}:desc=${lengthOf(option.desc)}`)
    }
  }
  assert.deepEqual(
    tooLong,
    [],
    `超过单行上限（字段 ${MAX_FIELD_DESC} / label ${MAX_OPTION_LABEL} / 取值说明 ${MAX_OPTION_DESC} 字）`
  )
  // 说明文本里不得出现硬换行（"最多一行"的兜底口径）
  const multiline = ALL_FIELDS.filter((field) => /[\r\n]/.test(String(field.desc ?? ''))).map(
    (field) => field.key
  )
  assert.deepEqual(multiline, [])
})

test('选项文本不重复取值（label 不得以取值数字开头，否则会显示成 "32 — 32 位"）', () => {
  const redundant = []
  for (const field of OPTION_FIELDS) {
    for (const option of field.options) {
      if (
        String(option.label ?? '')
          .trim()
          .startsWith(String(option.value))
      )
        redundant.push(`${field.key}=${option.value}:${option.label}`)
    }
  }
  assert.deepEqual(redundant, [], '选项文本已经是 `取值 — label`，label 里不要再写一遍取值')
})

test('optional 字段的"空值态"不走 options（留空选项由组件渲染，不计入官方取值）', () => {
  const optional = ALL_FIELDS.filter((field) => field.optional)
  assert.deepEqual(
    optional.map((field) => field.key),
    ['gatewayCredentialsSource'],
    '当前只有网关凭据来源需要"留空（不写该键）"'
  )
  for (const field of optional) {
    assert.equal(field.type, 'select', `${field.key} 的 optional 只在 select 上有意义`)
    assert.equal(field.def, '', `${field.key} 的默认值必须就是那个空值态`)
    assert.ok(String(field.emptyLabel ?? '').trim(), `${field.key} 必须给空值选项一个文案`)
    assert.ok(
      !field.options.some((option) => String(option.value) === ''),
      `${field.key} 的 options 里不得再混入空值（否则官方取值计数会漂）`
    )
  }
})

test('待确认清单与官方确证登记表一致（本次已全部确证 ⇒ 清单为空）', () => {
  const placeholders = [
    ...ALL_FIELDS.filter((field) => isPlaceholder(field.desc)).map((field) => field.key),
    ...OPTION_FIELDS.flatMap((field) =>
      field.options
        .filter((option) => isPlaceholder(option.desc) || isPlaceholder(option.label))
        .map((o) => `${field.key}=${o.value}`)
    )
  ]
  assert.deepEqual(placeholders, [], '还有占位文本，必须按官方文档补齐或登记来源')

  // 登记表里的每一条都必须真的在代码里（否则表与代码漂移）
  for (const [key, entry] of Object.entries(OFFICIALLY_CONFIRMED)) {
    assert.ok(entry.source.startsWith('https://'), `${key} 必须给出官方来源 URL`)
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, `${key} 必须记录确证日期`)
    if (entry.kind === 'field')
      assert.ok(
        ALL_FIELDS.some((field) => field.key === key),
        `缺字段 ${key}`
      )
    else {
      const [fieldKey, value] = key.split('=')
      const field = ALL_FIELDS.find((item) => item.key === fieldKey)
      assert.ok(field, `缺字段 ${fieldKey}`)
      assert.ok(
        field.options.some((option) => String(option.value) === value),
        `缺取值 ${key}`
      )
    }
  }

  // 确证后的语义要点必须真的写进了 desc（防止"登记了却仍写占位/写错"）
  const desc = (key) => ALL_FIELDS.find((field) => field.key === key).desc
  const optionDesc = (key, value) =>
    ALL_FIELDS.find((field) => field.key === key).options.find((o) => o.value === value).desc
  assert.match(desc('singleMonInWindowedMode'), /退出全屏/)
  assert.match(desc('usbDeviceStoreDirect'), /USB/)
  assert.match(desc('cameraStoreDirect'), /排除/)
  assert.match(desc('gatewayCredentialsSource'), /0–5/)
  assert.match(optionDesc('keyboardHook', 3), /RemoteApp/)
  assert.doesNotMatch(optionDesc('keyboardHook', 3), /待确认/)
  // B2 的取值来源必须能逐条对上官方的 0–5（含 5 = Cookie）
  const gatewayValues = ALL_FIELDS.find((f) => f.key === 'gatewayCredentialsSource').options.map(
    (o) => o.value
  )
  assert.deepEqual(gatewayValues, [0, 1, 2, 3, 4, 5])
  assert.match(optionDesc('gatewayCredentialsSource', 5), /Cookie/)
})

test('desc 不得含禁止词（等等 / 其余同上 / TODO）', () => {
  const banned = ['等等', '其余同上', 'TODO']
  const offenders = []
  for (const field of ALL_FIELDS) {
    const texts = [
      [field.key, field.desc],
      ...(field.options ?? []).map((option) => [`${field.key}=${option.value}`, option.desc])
    ]
    for (const [key, text] of texts) {
      for (const word of banned)
        if (String(text ?? '').includes(word)) offenders.push(`${key}:${word}`)
    }
  }
  assert.deepEqual(offenders, [])
})
