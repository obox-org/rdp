/**
 * `lib/connection.mjs` 单测：归一化默认值、校验失败路径、标题拼装、序列化（密码不入库）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  META_FIELDS,
  connectionTitle,
  fromDbRow,
  normalizeConnection,
  toDbRow,
  validateConnection
} from '../lib/connection.mjs'
import { RDP_FIELDS } from '../lib/rdpFile.mjs'

/** 界面 bridge.js 提交的形状：勾选框 0/1、数字/文本，见 src/fields.js 的 buildSavePayload */
function payload(extra = {}) {
  return { name: '生产跳板机', host: '10.0.0.8', port: 3389, remember: 1, ...extra }
}

test('归一化：补默认值且类型稳定（勾选框 → 布尔）', () => {
  const conn = normalizeConnection(payload())
  assert.equal(conn.name, '生产跳板机')
  assert.equal(conn.host, '10.0.0.8')
  assert.equal(conn.port, 3389)
  assert.equal(conn.remember, true)
  assert.equal(conn.username, '')
  assert.equal(conn.domain, '')
  assert.equal(conn.fullscreen, false)
  assert.equal(conn.nla, true)
  assert.equal(conn.clipboard, true)
  assert.equal(conn.deviceStoreDirect, '*')
  assert.equal(conn.desktopWidth, 1280)
  assert.equal(conn.authenticationLevel, 2)
  assert.equal(conn.sessionBpp, 32)
  assert.equal(conn.gatewayUsageMethod, 3)
  assert.equal(conn.id, undefined)

  const on = normalizeConnection(payload({ nla: 0, fullscreen: 1, remember: 0 }))
  assert.equal(on.nla, false)
  assert.equal(on.fullscreen, true)
  assert.equal(on.remember, false)

  // 字符串两侧空白被去掉（主机/域/路径都不该带空白）
  const trimmed = normalizeConnection(payload({ host: '  10.0.0.8  ', domain: ' CORP ' }))
  assert.equal(trimmed.host, '10.0.0.8')
  assert.equal(trimmed.domain, 'CORP')
})

test('归一化：id 只在合法正整数时保留', () => {
  assert.equal(normalizeConnection(payload({ id: 3 })).id, 3)
  assert.equal(normalizeConnection(payload({ id: '3' })).id, 3)
  assert.equal(normalizeConnection(payload({ id: '' })).id, undefined)
  assert.equal(normalizeConnection(payload({ id: null })).id, undefined)
  assert.equal(normalizeConnection(payload()).id, undefined)
})

test('校验失败路径：连接名空/重复、主机空、端口越界', () => {
  const empty = validateConnection(normalizeConnection({ host: '', port: 3389 }))
  assert.equal(empty.ok, false)
  assert.deepEqual(empty.errors.map((e) => e.field).sort(), ['host', 'name'])

  const badPort = validateConnection(normalizeConnection(payload({ port: 0 })))
  assert.equal(badPort.ok, false)
  assert.equal(badPort.errors[0].field, 'port')
  assert.equal(validateConnection(normalizeConnection(payload({ port: 65536 }))).ok, false)
  assert.equal(validateConnection(normalizeConnection(payload({ port: 'abc' }))).ok, false)
  assert.equal(validateConnection(normalizeConnection(payload({ port: 1 }))).ok, true)
  assert.equal(validateConnection(normalizeConnection(payload({ port: 65535 }))).ok, true)

  const rows = [{ id: 1, name: '生产跳板机' }]
  const dup = validateConnection(normalizeConnection(payload()), rows)
  assert.equal(dup.ok, false)
  assert.match(dup.errors[0].message, /已存在/)
  // 编辑自己不算重复
  assert.equal(validateConnection(normalizeConnection(payload({ id: 1 })), rows).ok, true)
  assert.equal(validateConnection(normalizeConnection(payload({ id: 2 })), rows).ok, false)
  // 列表为空 → 通过
  assert.equal(validateConnection(normalizeConnection(payload()), []).ok, true)
})

test('标题拼装：username@host:port，无用户名退化 host:port', () => {
  assert.equal(
    connectionTitle({ username: 'chenzhi', host: '10.0.0.8', port: 3389 }),
    'chenzhi@10.0.0.8:3389'
  )
  assert.equal(
    connectionTitle({ username: 'ops', host: 'win-srv', port: 13389 }),
    'ops@win-srv:13389'
  )
  assert.equal(connectionTitle({ host: 'win-srv', port: 13389 }), 'win-srv:13389')
  // 端口缺省按 3389；域不进标题（副行单独展示）
  assert.equal(
    connectionTitle({ username: 'chenzhi', domain: 'CORP', host: '10.0.0.8' }),
    'chenzhi@10.0.0.8:3389'
  )
})

test('toDbRow：密码不入库、字段齐全、时间戳按需补', () => {
  const conn = normalizeConnection(payload({ password: 'sup3r', username: 'chenzhi' }))
  const row = toDbRow(conn, { createdAt: 'C', updatedAt: 'U' })
  assert.equal(row.password, undefined)
  assert.equal(row.createdAt, 'C')
  assert.equal(row.updatedAt, 'U')
  assert.equal(row.id, undefined)
  for (const field of META_FIELDS) {
    if (field === 'id') continue
    assert.ok(field in row, `缺列 ${field}`)
  }
  for (const spec of RDP_FIELDS) {
    assert.ok(spec.field in row, `缺列 ${spec.field}`)
    assert.notEqual(row[spec.field], undefined, `列 ${spec.field} 不得为 undefined（列类型会漂）`)
  }
  // 只有 updatedAt 时不应带 createdAt（编辑用 patch）
  const patch = toDbRow(conn, { updatedAt: 'U2' })
  assert.equal(patch.createdAt, undefined)
  assert.equal(patch.updatedAt, 'U2')
})

test('fromDbRow：附派生 title/address，且不带未定义的 password', () => {
  const conn = fromDbRow({ id: 7, host: 'win-srv', port: 13389, username: 'ops', name: '测试机' })
  assert.equal(conn.id, 7)
  assert.equal(conn.name, '测试机')
  assert.equal(conn.title, 'ops@win-srv:13389')
  assert.equal(conn.address, 'win-srv:13389')
  assert.equal(conn.password, undefined)
  assert.equal(fromDbRow({ host: 'h', port: 3389 }).address, 'h')
  assert.equal(fromDbRow({ host: 'h' }).address, 'h')
  assert.equal(fromDbRow(null).title, ':3389')
})

test('归一化能容忍空载荷（不抛错，交给校验报错）', () => {
  const conn = normalizeConnection(undefined)
  assert.equal(conn.host, '')
  assert.equal(validateConnection(conn).ok, false)
})
