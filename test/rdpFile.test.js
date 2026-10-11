/**
 * `lib/rdpFile.mjs` 单测：字段映射、CRLF、转义、默认值省略、必填键与顺序。
 * 运行：node --test（扩展目录下）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_PORT,
  RDP_FIELDS,
  buildRdpText,
  escapeRdpValue,
  fieldValue,
  formatFullAddress,
  toBool,
  toInt,
  toPort
} from '../lib/rdpFile.mjs'

/** 最小可用连接（主机 + 默认端口） */
function base(extra = {}) {
  return { host: '10.0.0.8', port: DEFAULT_PORT, ...extra }
}

/** 文本 → 行数组（不带行尾） */
function lines(text) {
  return text.split('\r\n').slice(0, -1)
}

test('全默认连接：必填键 + 所有布尔键都显式写出', () => {
  const text = buildRdpText(base())
  const out = lines(text)
  assert.equal(out[0], 'full address:s:10.0.0.8')
  // 布尔项一律显式写出（真机踩过三次：缺 screen mode id → mstsc 默认全屏；use multimon 覆盖窗口模式；
  // 勾了剪贴板却因默认=1 被省略 → 用户以为没生效）。字符串/数值仍按"空/默认"省略。
  const keys = out.slice(1).map((line) => line.slice(0, line.lastIndexOf(':') + 1))
  for (const spec of RDP_FIELDS.filter((s) => s.type === 'bool' && !s.requires)) {
    assert.ok(keys.includes(spec.key), `${spec.key} 应显式写出`)
  }
  assert.ok(!keys.includes('use multimon:i:'), 'use multimon 依赖 fullscreen，默认连接不该写')
})

test('行尾一律 CRLF 且末尾带 CRLF', () => {
  const text = buildRdpText(base({ desktopWidth: 1920 }))
  assert.ok(text.endsWith('\r\n'))
  assert.ok(text.includes('\r\n'))
  assert.ok(!/(^|[^\r])\n/.test(text), '不应出现裸 LF')
  // 不以裸 \n 结尾（即每个 \n 前面都是 \r）
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') assert.equal(text[i - 1], '\r', `第 ${i} 字节是裸 LF`)
  }
})

test('非默认端口写进 full address，默认端口不写端口', () => {
  assert.equal(formatFullAddress('10.0.0.8', 3389), '10.0.0.8')
  assert.equal(formatFullAddress('10.0.0.8', 13389), '10.0.0.8:13389')
  assert.equal(formatFullAddress('win-srv', ''), 'win-srv')
  assert.ok(buildRdpText(base({ port: 13389 })).startsWith('full address:s:10.0.0.8:13389\r\n'))
})

test('只写非默认值：改过的键才出现', () => {
  const text = buildRdpText(
    base({
      username: 'chenzhi',
      domain: 'CORP',
      fullscreen: true,
      desktopWidth: 1920,
      desktopHeight: 1080,
      audioMode: 1,
      driveStoreDirect: 'C:\\;E:\\;'
    })
  )
  assert.ok(text.includes('username:s:chenzhi\r\n'))
  assert.ok(text.includes('domain:s:CORP\r\n'))
  assert.ok(text.includes('screen mode id:i:2\r\n'))
  assert.ok(text.includes('desktopwidth:i:1920\r\n'))
  assert.ok(text.includes('desktopheight:i:1080\r\n'))
  assert.ok(text.includes('audiomode:i:1\r\n'))
  assert.ok(text.includes('drivestoredirect:s:C:\\;E:\\;\r\n'), '反斜杠按字面写出')
  // 字符串/数值按"空或等于该键的 `.rdp` 默认值"省略。
  // `authentication level` 是特例：**官方默认 3、本扩展默认 2** ⇒ 缺省时也必须显式写出 2，
  // 否则 mstsc 回落到官方默认 3，界面上的"验证失败时警告"根本不生效（M2）。
  assert.ok(text.includes('authentication level:i:2\r\n'), '本扩展默认 2 ≠ 官方默认 3 → 显式写出')
  assert.ok(!text.includes('session bpp'), '数值等于 .rdp 默认 → 省略')
  assert.ok(!text.includes('devicestoredirect'), 'devicestoredirect 默认 `*` 省略')
  // 布尔项**不再因等于默认值而省略**（真机踩过三次，见 lib/rdpFile.mjs 的注释）
  assert.ok(text.includes('use multimon:i:0\r\n'), '全屏已开、多显未开 → 显式写 0')
  assert.ok(text.includes('smart sizing:i:1\r\n'), '布尔项显式写出，即使等于默认')
})

test('布尔键写成 0/1（含 false 与 true 两侧）', () => {
  const text = buildRdpText(base({ clipboard: false, nla: false, autoReconnect: false }))
  assert.ok(text.includes('redirectclipboard:i:0\r\n'))
  assert.ok(text.includes('enablecredsspsupport:i:0\r\n'))
  assert.ok(text.includes('autoreconnection enabled:i:0\r\n'))
  const on = buildRdpText(base({ promptForCredentials: true, adminSession: true }))
  assert.ok(on.includes('prompt for credentials:i:1\r\n'))
  assert.ok(on.includes('administrative session:i:1\r\n'))
})

test('转义：换行折叠，防止注入额外键（如 password 51:b:）', () => {
  assert.equal(escapeRdpValue('a\r\nb'), 'a b')
  assert.equal(escapeRdpValue('a\nb'), 'a b')
  assert.equal(escapeRdpValue('C:\\;E:\\;'), 'C:\\;E:\\;')
  const text = buildRdpText(
    base({
      username: 'evil\r\npassword 51:b:00112233',
      password: 'sup3r',
      domain: 'CORP\r\nfull address:s:attacker'
    })
  )
  assert.ok(!lines(text).some((line) => line.startsWith('password')), '绝不写出 password 键')
  // 伪造的 full address 只能作为 domain 的值留在同一行里，不能变成新行
  assert.equal(lines(text).filter((line) => line.startsWith('full address')).length, 1)
  assert.ok(lines(text).some((line) => line === 'domain:s:CORP full address:s:attacker'))
  assert.ok(text.includes('username:s:evil password 51:b:00112233\r\n'))
  assert.equal(lines(text).filter((line) => line.startsWith('full address')).length, 1)
})

test('绝不写 password / connection type / desktopscalefactor', () => {
  const text = buildRdpText(base({ password: 'x', connectionType: 1, desktopScaleFactor: 100 }))
  assert.ok(!text.includes('password'))
  assert.ok(!text.includes('connection type'))
  assert.ok(!text.includes('desktopscalefactor'))
})

test('gatewaycredentialssource 仅当有值才写（含数值 0 与 5）', () => {
  assert.ok(!buildRdpText(base()).includes('gatewaycredentialssource'))
  assert.ok(
    !buildRdpText(base({ gatewayCredentialsSource: '' })).includes('gatewaycredentialssource')
  )
  assert.ok(
    buildRdpText(base({ gatewayCredentialsSource: '3' })).includes(
      'gatewaycredentialssource:i:3\r\n'
    )
  )
  // 界面改成下拉框后，取值是**数字**（0–5）；0 是合法取值，绝不能被当成"空"吞掉（M4）
  assert.ok(
    buildRdpText(base({ gatewayCredentialsSource: 0 })).includes(
      'gatewaycredentialssource:i:0\r\n'
    ),
    '数值 0（询问密码）必须写出'
  )
  assert.ok(
    buildRdpText(base({ gatewayCredentialsSource: 5 })).includes(
      'gatewaycredentialssource:i:5\r\n'
    ),
    '数值 5（Cookie）必须写出'
  )
})

test('必填键在最前，其余按 §3.6 行序', () => {
  // 全部字段都取非默认值 → 每一行都必须出现，且顺序与字段表逐条一致
  const conn = { host: '10.0.0.8', port: 13389 }
  for (const spec of RDP_FIELDS) {
    if (spec.type === 'string')
      conn[spec.field] = spec.rdpDefault === undefined ? `v-${spec.field}` : 'x'
    else if (spec.type === 'bool') conn[spec.field] = !spec.def
    else conn[spec.field] = (spec.rdpDefault ?? spec.def) + 1
  }
  const keyOf = (line) => line.slice(0, line.indexOf(':', line.indexOf(':') + 1) + 1)
  const keys = lines(buildRdpText(conn)).map(keyOf)
  assert.deepEqual(keys, ['full address:s:', ...RDP_FIELDS.map((spec) => spec.key)])
  assert.ok(keys.indexOf('username:s:') < keys.indexOf('domain:s:'))
  assert.ok(keys.indexOf('autoreconnection enabled:i:') < keys.indexOf('screen mode id:i:'))
})

test('主机为空直接抛错（不生成空 full address）', () => {
  assert.throws(() => buildRdpText({ host: '', port: 3389 }), /非空主机/)
  assert.throws(() => buildRdpText({ host: '   ' }), /非空主机/)
  assert.throws(() => buildRdpText(undefined), /非空主机/)
})

test('fieldValue 逐个字段的省略口径', () => {
  const byField = new Map(RDP_FIELDS.map((spec) => [spec.field, spec]))
  assert.equal(fieldValue(byField.get('desktopWidth'), { desktopWidth: 1280 }), null)
  assert.equal(fieldValue(byField.get('desktopWidth'), { desktopWidth: 1920 }), '1920')
  // 不勾全屏 → **必须显式写 1**：mstsc 在缺这个键时默认是全屏（真机实测），
  // 所以这里不再是 null（省略），否则用户"取消全屏"反而不生效。
  assert.equal(fieldValue(byField.get('fullscreen'), { fullscreen: false }), '1')
  // use multimon 以 fullscreen 为前提：全屏关掉时不写（否则 mstsc 会忽略 windowed 而跨屏全屏）
  assert.equal(fieldValue(byField.get('multimon'), { fullscreen: false, multimon: true }), null)
  assert.equal(fieldValue(byField.get('multimon'), { fullscreen: true, multimon: true }), '1')
  assert.equal(fieldValue(byField.get('fullscreen'), { fullscreen: true }), '2')
  assert.equal(fieldValue(byField.get('username'), { username: '' }), null)
  assert.equal(fieldValue(byField.get('username'), { username: 'u' }), 'u')
  assert.equal(fieldValue(byField.get('deviceStoreDirect'), { deviceStoreDirect: '*' }), null)
  // authentication level：官方默认 3 ⇒ 只有取 3 才省略；本扩展默认 2（fields.js 的 def）一定写出
  assert.equal(fieldValue(byField.get('authenticationLevel'), {}), '2')
  assert.equal(fieldValue(byField.get('authenticationLevel'), { authenticationLevel: 3 }), null)
  // 布尔项的 rdpDefault 不参与判断（`fieldValue` 的 bool 分支从不读它）：官方默认 0 的
  // smart sizing 在本扩展默认 true，也必须显式写出 1
  assert.equal(fieldValue(byField.get('smartSizing'), {}), '1')
  assert.equal(fieldValue(byField.get('clipboard'), {}), '1')
})

test('取值归一工具', () => {
  assert.equal(toPort(''), DEFAULT_PORT)
  assert.equal(toPort('13389'), 13389)
  assert.equal(toPort(13389.7), 13389)
  assert.ok(Number.isNaN(toPort('abc')))
  assert.equal(toInt('', 7), 7)
  assert.equal(toInt(undefined, 7), 7)
  assert.equal(toInt('12.9', 7), 12)
  assert.equal(toInt('abc', 7), 7)
  assert.equal(toInt(true, 0), 1)
  assert.equal(toBool(1), true)
  assert.equal(toBool('1'), true)
  assert.equal(toBool(0), false)
  assert.equal(toBool(undefined), false)
})
