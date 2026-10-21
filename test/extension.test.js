/**
 * 入口 `index.js` 的行为测试（mock 注入的 api，不依赖 Electron/宿主）。
 *
 * 钉死的是**消息契约**与副作用顺序：
 * - 页面发 `{ channel:'rdp', payload:{ method, payload } }`（见 src/bridge.js），
 *   入口返回 `{ ok:true, data }` / `{ ok:false, error }`。
 * - save：校验 → insert/update → 按 remember 写/删 `api.secrets`
 * - remove：helper.deleteCredential（非致命）→ secrets.delete → db.del
 * - open：secrets.get → 生成 .rdp → helper.launch（fileName `<id>.rdp`）→ `{ pid: null, path, warnings }`
 * - uninstall(ctx)：逐个删除 `conn:<id>`
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import rdp, { uninstall } from '../index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))

/** 极简内存表：行为对齐 api.sqlite（insert 返回新行、get_all 全量、update/del 按 id） */
function makeDb() {
  const rows = []
  let nextId = 1
  return {
    rows,
    async get_all() {
      return rows.map((row) => ({ ...row }))
    },
    async insert(row) {
      const created = { id: nextId++, ...row }
      rows.push(created)
      return { ...created }
    },
    async update(where, patch) {
      let changes = 0
      for (const row of rows) {
        if (String(row.id) === String(where.id)) {
          Object.assign(row, patch)
          changes++
        }
      }
      return changes
    },
    async get(id) {
      const found = rows.find((row) => String(row.id) === String(id))
      return found ? { ...found } : undefined
    },
    async del(id) {
      const index = rows.findIndex((row) => String(row.id) === String(id))
      if (index < 0) return 0
      rows.splice(index, 1)
      return 1
    },
    async close() {}
  }
}

function makeApi() {
  const db = makeDb()
  const calls = {
    card: undefined,
    handler: undefined,
    disposed: [],
    requested: [],
    secrets: new Map(),
    connected: [],
    closed: []
  }
  const responses = {
    probe: { cwd: 'C:\\data', node: '24.0.0', electron: null, runAsNode: '1' },
    launch: { pid: null, path: 'C:\\data\\rdp\\1.rdp', warnings: ['凭据可能未保存（TERMSRV/h）'] },
    deleteCredential: { deleted: [], warnings: ['TERMSRV/h: 找不到凭据'] }
  }
  const api = {
    app: {
      register: (registration) => {
        calls.card = registration
        return { dispose: () => calls.disposed.push('card') }
      },
      onMessage: (handler) => {
        calls.handler = handler
        return { dispose: () => calls.disposed.push('message') }
      }
    },
    sqlite: {
      open: async (name) => {
        calls.dbName = name
        return db
      }
    },
    secrets: {
      get: async (key) => calls.secrets.get(key),
      set: async (key, value) => {
        calls.secrets.set(key, value)
      },
      delete: async (key) => {
        calls.secrets.delete(key)
      }
    },
    ipc: {
      connect: async (id) => calls.connected.push(id),
      request: async (id, method, params) => {
        calls.requested.push({ id, method, params })
        return responses[method]
      },
      close: async (id) => calls.closed.push(id),
      onClose: () => ({ dispose: () => calls.disposed.push('close') })
    }
  }
  return { api, db, calls, responses }
}

/** 界面 src/fields.js 的 buildSavePayload 形状（勾选框 0/1、密码只在记住且有值时提交） */
function formPayload(extra = {}) {
  return {
    name: '生产跳板机',
    host: '10.0.0.8',
    port: 3389,
    username: 'chenzhi',
    domain: 'CORP',
    remember: 1,
    fullscreen: 0,
    nla: 1,
    clipboard: 1,
    deviceStoreDirect: '*',
    desktopWidth: 1280,
    desktopHeight: 800,
    password: 'sup3r',
    ...extra
  }
}

/** 走 bridge.js 的真实形状：channel 固定 'rdp'，方法在 payload.method 里 */
function call(calls, method, payload) {
  return calls.handler('rdp', { method, payload })
}

test('注册的卡片与 manifest 一致', () => {
  const { api, calls } = makeApi()
  const dispose = rdp(api)
  assert.equal(calls.card.id, 'rdp.main')
  assert.equal(calls.card.name, manifest.displayName)
  assert.equal(calls.card.author, manifest.author)
  assert.equal(calls.card.version, manifest.version)
  assert.equal(calls.card.multiOpen, false)
  assert.equal(calls.card.width, 1024)
  assert.equal(calls.card.height, 720)
  assert.match(calls.card.icon, /^<svg/)
  assert.ok(calls.card.url.endsWith('/ui/index.html'), calls.card.url)
  // 宿主模式（obox 2.0.0 起）入口是 file:// 加载的：页面 URL 必须仍是 app:// 形状，
  // 否则主窗口 CSP（default-src 'self' app:）会把子窗口 iframe 拦掉 ⇒ 卡片空白。
  assert.match(
    calls.card.url,
    /^app:\/\/(extensions|debug)\/[^/]+\/ui\/index\.html$/,
    calls.card.url
  )
  assert.equal(manifest.contributes.ipcChannels[0].id, 'rdp.helper')
  assert.equal(manifest.contributes.ipcChannels[0].framing, 'ndjson')
  dispose()
  assert.deepEqual(calls.disposed.sort(), ['card', 'close', 'message'])
})

test('list：打开 rdp.db，按 createdAt 升序返回', async () => {
  const { api, db, calls } = makeApi()
  rdp(api)
  db.rows.push(
    { id: 2, name: 'b', host: 'h2', port: 3389, createdAt: '2024-02-01T00:00:00.000Z' },
    { id: 1, name: 'a', host: 'h1', port: 3389, createdAt: '2024-01-01T00:00:00.000Z' }
  )
  const reply = await call(calls, 'list', {})
  assert.equal(reply.ok, true)
  assert.deepEqual(
    reply.data.map((row) => row.id),
    [1, 2]
  )
  assert.equal(reply.data[0].title, 'h1:3389')
  assert.equal(calls.dbName, 'rdp.db')
})

test('list：也接受 channel 直接当方法名的写法', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const reply = await calls.handler('list', {})
  assert.deepEqual(reply, { ok: true, data: [] })
})

test('save（新建）：insert 补齐时间戳、密码写进 secrets', async () => {
  const { api, db, calls } = makeApi()
  rdp(api)
  const reply = await call(calls, 'save', formPayload())

  assert.equal(reply.ok, true)
  assert.equal(reply.data.id, 1)
  assert.equal(reply.data.title, 'chenzhi@10.0.0.8:3389')
  assert.ok(reply.data.createdAt, '应补 createdAt')
  assert.equal(reply.data.createdAt, reply.data.updatedAt)
  assert.equal(reply.data.password, undefined, '密码不得入库')
  assert.equal(db.rows[0].password, undefined)
  assert.equal(calls.secrets.get('conn:1'), 'sup3r')
  assert.equal(db.rows[0].remember, true)
  assert.equal(db.rows[0].clipboard, true)
  assert.equal(db.rows[0].username, 'chenzhi')
})

test('save（校验失败）：不写库、不动 secrets', async () => {
  const { api, db, calls } = makeApi()
  rdp(api)
  const bad = await call(calls, 'save', formPayload({ name: '', host: '' }))
  assert.equal(bad.ok, false)
  assert.match(bad.error, /连接名不能为空/)
  assert.match(bad.error, /主机不能为空/)
  assert.equal(db.rows.length, 0)
  assert.equal(calls.secrets.size, 0)

  db.rows.push({ id: 9, name: '生产跳板机', host: 'x', port: 3389, createdAt: 'c' })
  const dup = await call(calls, 'save', formPayload())
  assert.equal(dup.ok, false)
  assert.match(dup.error, /已存在/)
  assert.equal(db.rows.length, 1)
})

test('save（编辑）：update 原地更新并写 updatedAt', async () => {
  const { api, db, calls } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', formPayload({ port: 13389 }))
  const reply = await call(calls, 'save', formPayload({ id: created.data.id, port: 33890 }))
  assert.equal(reply.ok, true)
  assert.equal(reply.data.id, 1)
  assert.equal(reply.data.port, 33890)
  assert.equal(reply.data.createdAt, created.data.createdAt, 'createdAt 不应被改写')
  assert.equal(db.rows.length, 1)

  // 不存在的 id → 报错而不是静默插入
  const missing = await call(calls, 'save', formPayload({ id: 999 }))
  assert.equal(missing.ok, false)
  assert.match(missing.error, /连接不存在/)
  assert.equal(db.rows.length, 1)
})

test('save：remember=false 时删除已保存的密码，且不写新值', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', formPayload())
  assert.equal(calls.secrets.get('conn:1'), 'sup3r')

  const reply = await call(
    calls,
    'save',
    formPayload({ id: created.data.id, remember: 0, password: '' })
  )
  assert.equal(reply.ok, true)
  assert.equal(calls.secrets.has('conn:1'), false)

  // 记住密码但没重新输入密码：保留旧值（此处已删，故仍不存在）
  calls.secrets.set('conn:1', 'kept')
  await call(calls, 'save', formPayload({ id: created.data.id, password: '' }))
  assert.equal(calls.secrets.get('conn:1'), 'kept')
})

test('remove：helper 清凭据（含 warnings）→ secrets → 删库行', async () => {
  const { api, db, calls } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', formPayload({ port: 13389 }))
  const reply = await call(calls, 'remove', { id: created.data.id })

  assert.equal(reply.ok, true)
  assert.equal(calls.connected[0], 'rdp.helper')
  const del = calls.requested.find((item) => item.method === 'deleteCredential')
  assert.deepEqual(del.params, { host: '10.0.0.8', port: 13389 })
  assert.equal(calls.secrets.has('conn:1'), false)
  assert.equal(db.rows.length, 0)
  assert.deepEqual(reply.data.warnings, ['TERMSRV/h: 找不到凭据'])
})

test('remove：helper 失败不算致命，记进 warnings 且仍删库行', async () => {
  const { api, db, calls, responses } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', formPayload())
  delete responses.deleteCredential
  // 让 request 抛错模拟 helper 不可用
  const originalRequest = api.ipc.request
  api.ipc.request = async (id, method, params) => {
    if (method === 'deleteCredential') throw new Error('[connect-failed] 无法启动助手')
    return originalRequest(id, method, params)
  }
  const reply = await call(calls, 'remove', { id: created.data.id })
  assert.equal(reply.ok, true)
  assert.equal(db.rows.length, 0)
  assert.equal(reply.data.warnings.length, 1)
  assert.match(reply.data.warnings[0], /凭据未清理/)
  assert.equal(calls.secrets.has('conn:1'), false)
})

test('remove：id 非法直接报错', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const reply = await call(calls, 'remove', {})
  assert.equal(reply.ok, false)
  assert.match(reply.error, /需要合法的 id/)
})

test('open：生成 .rdp + 预置凭据 + 派发 mstsc，返回 { pid:null, path }（不要求 pid）', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', formPayload({ port: 13389, fullscreen: 1 }))
  const reply = await call(calls, 'open', { id: created.data.id })

  assert.equal(reply.ok, true)
  // 经 cmd /c start 派发 ⇒ mstsc 不是我们的子进程，拿不到 pid；字段保留但恒为 null（ADR-0003）。
  // "成功"的判据换成 path / warnings 真的回来了，不是把断言删掉。
  assert.equal(reply.data.pid, null)
  assert.equal(reply.data.path, 'C:\\data\\rdp\\1.rdp')
  const launch = calls.requested.find((item) => item.method === 'launch')
  assert.equal(launch.params.fileName, '1.rdp')
  assert.match(launch.params.rdpText, /^full address:s:10\.0\.0\.8:13389\r\n/)
  assert.ok(launch.params.rdpText.includes('username:s:chenzhi\r\n'))
  assert.ok(launch.params.rdpText.includes('screen mode id:i:2\r\n'))
  assert.ok(!launch.params.rdpText.includes('password'))
  assert.deepEqual(launch.params.credential, {
    host: '10.0.0.8',
    port: 13389,
    user: 'chenzhi',
    pass: 'sup3r',
    domain: 'CORP'
  })
  assert.deepEqual(reply.data.warnings, ['凭据可能未保存（TERMSRV/h）'])
})

test('open：helper 回空值 / 非对象 ⇒ ok:false（pid 判据删了，但"回包形状"判据必须留着）', async () => {
  const { api, calls, responses } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', formPayload())
  // 真实故障：通道没连上 / 回包为空 ⇒ 调用方拿 `result?.x` 会静默变成 undefined。
  // 这条分支是"删掉 pid 判据"之后仍然成立的输入校验（spec §7.2 的刻意保留）。
  for (const bad of [null, undefined, 'oops', 42]) {
    responses.launch = bad
    const reply = await call(calls, 'open', { id: created.data.id })
    assert.equal(reply.ok, false, `launch 回 ${String(bad)} 时必须失败`)
    assert.match(reply.error, /未能拉起 mstsc\.exe/)
  }
})

test('open：没有已保存的密码时 credential 为 null', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', formPayload({ remember: 0, password: '' }))
  const reply = await call(calls, 'open', { id: created.data.id })
  assert.equal(reply.ok, true)
  assert.equal(calls.requested.find((item) => item.method === 'launch').params.credential, null)
})

test('open：连接不存在 / id 非法时报错', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  assert.match((await call(calls, 'open', { id: 42 })).error, /连接不存在/)
  assert.match((await call(calls, 'open', {})).error, /需要合法的 id/)
})

test('probe：透传 helper 的环境信息', async () => {
  const { api, calls, responses } = makeApi()
  rdp(api)
  const reply = await call(calls, 'probe', {})
  assert.deepEqual(reply, { ok: true, data: responses.probe })
})

test('未知方法返回 ok:false（不抛错，桥仍能回包）', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const reply = await call(calls, 'destroy', {})
  assert.equal(reply.ok, false)
  assert.match(reply.error, /未知方法: destroy/)
})

test('ipc 只连一次，dispose 时关闭通道', async () => {
  const { api, calls } = makeApi()
  const dispose = rdp(api)
  await call(calls, 'probe', {})
  await call(calls, 'probe', {})
  assert.deepEqual(calls.connected, ['rdp.helper'])
  assert.equal(calls.closed.length, 0)
  dispose()
  assert.deepEqual(calls.closed, ['rdp.helper'])
})

test('uninstall(ctx)：按库里的 id 逐个删除 conn:<id>', async () => {
  const { api, db, calls } = makeApi()
  db.rows.push({ id: 1, name: 'a' }, { id: 2, name: 'b' })
  calls.secrets.set('conn:1', 'p1')
  calls.secrets.set('conn:2', 'p2')
  calls.secrets.set('other:key', 'keep')
  await uninstall({ api })
  assert.equal(calls.secrets.has('conn:1'), false)
  assert.equal(calls.secrets.has('conn:2'), false)
  assert.equal(calls.secrets.get('other:key'), 'keep')
  assert.equal(calls.dbName, 'rdp.db')
})

test('uninstall：库不可用时只记日志、不抛错', async () => {
  const broken = {
    secrets: { delete: async () => {} },
    sqlite: {
      open: async () => {
        throw new Error('数据库未打开')
      }
    }
  }
  await uninstall({ api: broken })
  await uninstall({})
  await uninstall(undefined)
})

test('宿主模式门禁：入口与 lib/ 不碰 DOM（宿主进程没有 window/document/localStorage）', () => {
  // obox 2.0.0 起用户扩展在 Extension Host Process 里执行：入口里出现任何 DOM 全局即坏。
  // 只扫入口一侧（index.js + lib/*.mjs）；DOM 属于子窗口静态页（src/ → ui/），不在此列。
  const sources = [
    join(root, 'index.js'),
    ...readdirSync(join(root, 'lib')).map((name) => join(root, 'lib', name))
  ]
  for (const file of sources) {
    const code = readFileSync(file, 'utf8')
      // 去掉注释再判，避免注释里写 "window/document" 造成假红
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const banned of ['window.', 'document.', 'localStorage', 'sessionStorage', 'navigator.']) {
      assert.ok(!code.includes(banned), `${file} 里出现了宿主进程没有的 DOM 能力：${banned}`)
    }
  }
})
