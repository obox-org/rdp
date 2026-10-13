/**
 * 密码回填与「清空即删除」的保存语义（本次变更的行为测试）。
 *
 * 三块，都钉在**真实代码路径**上（mock 注入的 api，不依赖 Electron/宿主）：
 *   A. 新消息方法 `password`（入参 `{ id }` → `{ password }`）：有密码原样返回、无密码空串、
 *      `api.secrets.get` 抛错时空串且**不抛**（读不到密码不该挡住编辑）；id 非法沿用其它方法口径。
 *   B. 不得泄漏：密码明文只允许出现在 `password` 的 `data.password` 里——日志（console.*）、
 *      卡片列表（`list`）、打开连接的回包（`open`）都不许出现它。思路同 test/helperSanitize.test.js：
 *      断言"输出文本里不含那个串"。
 *   C. 保存语义（本次的取舍，README §4.1）：**清空密码框 = 删除 `conn:<id>`**，但只认界面显式
 *      声明的 `clearPassword`（界面只在**确实回填过**已存密码、而现在该框被清空时才发它）——
 *      这样"只改其它字段、没碰密码"与"读取失败（拿不准）"都不会误删。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import rdp from '../index.js'
import { buildSavePayload, defaultForm, rowToForm } from '../src/fields.js'

/** 密码样例：含空格与非 ASCII，便于在 文本 / JSON / 日志 里认出它 */
const SECRET = 'p@ss Word-秘密42'
/**
 * 它在 `JSON.stringify` 结果里的形态。
 *
 * ⚠️ 拿 JSON 文本查明文时**必须**用这个而不是 `SECRET`：`JSON.stringify` 会转义控制字符
 * （例如含 `\t` 的密码在 JSON 里是 `\\t`，用原串去 `includes` 会**恒为假**、把断言喂成假绿）。
 */
const SECRET_JSON = JSON.stringify(SECRET).slice(1, -1)

/** 极简内存表（行为对齐 api.sqlite；与 test/extension.test.js 同一套口径） */
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
      for (const row of rows) if (String(row.id) === String(where.id)) Object.assign(row, patch)
    },
    async get(id) {
      const found = rows.find((row) => String(row.id) === String(id))
      return found ? { ...found } : undefined
    },
    async del(id) {
      const index = rows.findIndex((row) => String(row.id) === String(id))
      if (index >= 0) rows.splice(index, 1)
    },
    async close() {}
  }
}

/**
 * @param {{ getError?: Error }} [options] `getError` 让 `api.secrets.get` 抛错（模拟凭据库不可用）
 */
function makeApi(options = {}) {
  const db = makeDb()
  const calls = { card: undefined, handler: undefined, secrets: new Map(), requested: [] }
  const api = {
    app: {
      register: (registration) => {
        calls.card = registration
        return { dispose() {} }
      },
      onMessage: (handler) => {
        calls.handler = handler
        return { dispose() {} }
      }
    },
    sqlite: { open: async () => db },
    secrets: {
      get: async (key) => {
        if (options.getError) throw options.getError
        return calls.secrets.get(key)
      },
      set: async (key, value) => {
        calls.secrets.set(key, value)
      },
      delete: async (key) => {
        calls.secrets.delete(key)
      }
    },
    ipc: {
      connect: async () => {},
      request: async (id, method, params) => {
        calls.requested.push({ id, method, params })
        return { pid: null, path: 'C:\\data\\rdp\\1.rdp', warnings: [] }
      },
      close: async () => {},
      onClose: () => ({ dispose() {} })
    }
  }
  return { api, db, calls }
}

/** 走 bridge.js 的真实形状：channel 固定 'rdp'，方法在 payload.method 里 */
function call(calls, method, payload) {
  return calls.handler('rdp', { method, payload })
}

/** save 的载荷（界面 buildSavePayload 的形状；只补本文件用到的列） */
function payload(extra = {}) {
  return {
    name: '生产跳板机',
    host: '10.0.0.8',
    port: 3389,
    remember: 1,
    password: SECRET,
    ...extra
  }
}

/** 把 console.* 全部接管，返回收集到的日志文本（测试结束由 t.mock 自动还原） */
function captureConsole(t) {
  const lines = []
  for (const level of ['log', 'info', 'warn', 'error']) {
    t.mock.method(console, level, (...args) => {
      lines.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '))
    })
  }
  return () => lines.join('\n')
}

/* ---------- A. 新消息方法 password ---------- */

test('password：有已存密码 → 原样返回（且只返回这一个字段）', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  calls.secrets.set('conn:7', SECRET)

  const reply = await call(calls, 'password', { id: 7 })
  assert.deepEqual(reply, { ok: true, data: { password: SECRET } })
  assert.deepEqual(Object.keys(reply.data), ['password'], '不该顺手把别的字段带出来')
})

test('password：没有已存密码 → 空串（ok:true，不报错）', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  // 连 id 都没存过 secret（也覆盖 get 返回 undefined 的情况）
  assert.deepEqual(await call(calls, 'password', { id: 1 }), { ok: true, data: { password: '' } })
  // 存了空串也算"没有"
  calls.secrets.set('conn:2', '')
  assert.deepEqual(await call(calls, 'password', { id: 2 }), { ok: true, data: { password: '' } })
})

test('password：api.secrets.get 抛错 → 空串且不抛（错误文本里的明文也不外泄）', async (t) => {
  // 故意让底层异常**带着密码明文**（最坏情况）：password 路径既不回包也不打日志把它带出去
  const { api, calls } = makeApi({ getError: new Error(`无法解密 conn:3（值 ${SECRET}）`) })
  rdp(api)
  const logged = captureConsole(t)

  const reply = await call(calls, 'password', { id: 3 })
  assert.deepEqual(reply, { ok: true, data: { password: '' } }, '读不到密码不报错（不挡编辑）')
  assert.ok(!JSON.stringify(reply).includes(SECRET_JSON), '回包里不得出现明文')
  assert.equal(logged(), '', 'password 路径不该产生任何日志')
})

test('password：id 非法 / 入参缺省 → ok:false（与 remove/open 同一口径）', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  assert.match((await call(calls, 'password', {})).error, /需要合法的 id/)
  assert.match((await call(calls, 'password', { id: 'abc' })).error, /需要合法的 id/)
  assert.match((await call(calls, 'password', { id: 'temp-123' })).error, /需要合法的 id/)
})

/* ---------- B. 不得泄漏 ---------- */

test('不得泄漏：密码只出现在 password 的 data.password 里（日志 / list / open 都没有）', async (t) => {
  const { api, calls } = makeApi()
  rdp(api)
  const logged = captureConsole(t)

  const created = await call(calls, 'save', payload())
  const card = await call(calls, 'list', {})
  const opened = await call(calls, 'open', { id: created.data.id })
  const back = await call(calls, 'password', { id: created.data.id })

  assert.equal(calls.secrets.get(`conn:${created.data.id}`), SECRET, '前置：密码确实存进了 secrets')
  assert.equal(card.ok, true)
  assert.ok(!JSON.stringify(card.data).includes(SECRET_JSON), '卡片列表里不得出现密码')
  assert.ok(
    !JSON.stringify(opened.data).includes(SECRET_JSON),
    'open 的回包（只进控制台）里不得出现密码'
  )
  assert.ok(!logged().includes(SECRET), `日志里不得出现密码：${logged()}`)

  // 唯一允许出现的地方：data.password，且只有一次
  assert.equal(JSON.stringify(back).split(SECRET_JSON).length - 1, 1, '回包里明文只该出现一次')
  assert.equal(back.data.password, SECRET)
  // 密码本身就写在 .rdp / cmdkey 实参里交给 helper——那是设计内的（open 的 credential.pass）
  const launch = calls.requested.find((item) => item.method === 'launch')
  assert.equal(launch.params.credential.pass, SECRET)
  assert.ok(!launch.params.rdpText.includes(SECRET), '.rdp 文本里绝不许出现密码')
})

/* ---------- C. 保存语义：清空即删除（只认显式意图） ---------- */

test('save：clearPassword=1 且密码为空 → 删除已存 secret（"清空即删除"）', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', payload())
  assert.equal(calls.secrets.get(`conn:${created.data.id}`), SECRET)

  const reply = await call(
    calls,
    'save',
    payload({ id: created.data.id, password: '', clearPassword: 1 })
  )
  assert.equal(reply.ok, true)
  assert.equal(calls.secrets.has(`conn:${created.data.id}`), false, '已存密码必须被删掉')
})

test('save：只改其它字段（不发 clearPassword）→ 旧密码保留，绝不误删', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', payload())
  const id = created.data.id

  // ① 界面完全没碰密码框时，回填的值会原样提交 → 等同重写一遍
  const kept = await call(calls, 'save', payload({ id, host: '10.0.0.9', password: SECRET }))
  assert.equal(kept.ok, true)
  assert.equal(calls.secrets.get(`conn:${id}`), SECRET)

  // ② 连密码字段都没给（老界面 / 只传部分字段）→ 同样保留（扩展侧单独"空密码"不算清空）
  const legacy = await call(calls, 'save', payload({ id, host: '10.0.0.10', password: '' }))
  assert.equal(legacy.ok, true)
  assert.equal(calls.secrets.get(`conn:${id}`), SECRET, '没有 clearPassword 意图时不得删密码')
})

test('save：clearPassword 与 password 同时给 → 以写为准（不删）', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', payload({ password: 'old-one' }))
  const id = created.data.id

  const reply = await call(calls, 'save', payload({ id, password: 'new-one', clearPassword: 1 }))
  assert.equal(reply.ok, true)
  assert.equal(calls.secrets.get(`conn:${id}`), 'new-one', '有值就写：清的意图不得盖掉新密码')
})

test('save：remember=false → 与既有口径一致（删除 secret，且在清空之前就删）', async () => {
  const { api, calls } = makeApi()
  rdp(api)
  const created = await call(calls, 'save', payload())
  const reply = await call(
    calls,
    'save',
    payload({ id: created.data.id, remember: 0, password: '', clearPassword: 1 })
  )
  assert.equal(reply.ok, true)
  assert.equal(calls.secrets.has(`conn:${created.data.id}`), false)
})

test('open：secrets.get 抛错 → credential=null + warning（改用公共读取入口后口径不变）', async () => {
  const { api, calls } = makeApi({ getError: new Error('凭据库不可用') })
  rdp(api)
  // 直接造一行（save 也会经 secrets，这里只关心 open 的读取容错）
  const db = await api.sqlite.open('rdp.db')
  await db.insert({ id: 1, name: 'a', host: 'h', port: 3389, username: 'u' })

  const reply = await call(calls, 'open', { id: 1 })
  assert.equal(reply.ok, true)
  assert.equal(calls.requested.find((item) => item.method === 'launch').params.credential, null)
  assert.match(reply.data.warnings.join('；'), /读取已保存的密码失败：凭据库不可用/)
})

/* ---------- D. 界面侧判定（buildSavePayload 的纯函数口径） ---------- */

/** 一条"编辑中"的表单：`rowToForm(行)` + 回填后的密码（与 ConnectionModal.vue 的写法一致） */
function editForm(extra = {}) {
  const row = { id: 5, name: 'A', host: 'a.example', port: 3389, remember: true }
  return { ...rowToForm(row), password: SECRET, ...extra }
}

test('buildSavePayload：编辑时清空（storedPassword 非空）→ 发 clearPassword', () => {
  const out = buildSavePayload(editForm({ password: '' }), { storedPassword: SECRET })
  assert.equal(out.clearPassword, 1)
  assert.equal(out.password, undefined, '清空时不该再提交密码')
})

test('buildSavePayload：没动密码 → 重写回填值，且不带 clearPassword', () => {
  const out = buildSavePayload(editForm({ host: 'b.example' }), { storedPassword: SECRET })
  assert.equal(out.password, SECRET, '密码框里还是回填的原值 → 原样提交')
  assert.equal(out.clearPassword, undefined)
})

test('buildSavePayload：拿不准就绝不删（新建 / 读不到密码时 storedPassword 为空）', () => {
  // 新建（无 id）：即使有人把 storedPassword 传进来也不算清空
  const created = buildSavePayload(
    { ...defaultForm(), name: 'n', host: 'h', password: '' },
    {
      storedPassword: SECRET
    }
  )
  assert.equal(created.clearPassword, undefined)
  assert.equal(created.id, undefined)
  // 编辑但**没读到**已存密码（读取失败 / 从未存过）→ 空密码框不得变成删除
  const unknown = buildSavePayload(editForm({ password: '' }), { storedPassword: '' })
  assert.equal(unknown.clearPassword, undefined)
  // 连 options 都没给（老调用点）→ 同样不发
  assert.equal(buildSavePayload(editForm({ password: '' })).clearPassword, undefined)
})

test('buildSavePayload：remember 未勾 / 密码框不可见（Entra ID）→ 不发 clearPassword', () => {
  const unchecked = buildSavePayload(editForm({ password: '', remember: false }), {
    storedPassword: SECRET
  })
  assert.equal(unchecked.clearPassword, undefined, '取消记住密码走既有的 !remember 删除分支')
  const entra = buildSavePayload(editForm({ password: '', enableRdsAadAuth: true }), {
    storedPassword: SECRET
  })
  assert.equal(entra.clearPassword, undefined, '屏幕上没有密码框时不得改后台的密码')
  assert.equal(entra.password, undefined)
})
