/**
 * 远程桌面扩展入口（用户扩展，纯 ESM，经 .oix 安装到 userData/extensions/<name>_<author>/）。
 *
 * 组成（设计 §3.2）：
 * - `api.app.register` 注册 App 卡片 → 子窗口加载 `ui/index.html`（Vite 构建产物）
 * - `api.app.onMessage` 提供 6 个方法：list / save / remove / open / probe / password
 * - `api.sqlite.open('rdp.db')` 存连接（扁平列，字段名与界面 fields.js 一一对应）
 * - `api.secrets` 存密码（键 `conn:<id>`，密码**不入库**）
 * - `api.ipc` 通道 `rdp.helper`（manifest 静态声明，stdio + ndjson）拉起 helper.cjs：
 *   它负责写 `.rdp`、`cmdkey` 预置凭据、**经 `cmd /c start` 以孤儿进程派发 `mstsc.exe`**
 *   （mstsc 因此不在 obox 进程树内，见 `docs/adr/0003`）
 *
 * 消息契约（与 `src/bridge.js` 对齐）：
 *   页面 → 宿主：`{ source:'obox-app', action:'obox-extension', appId:'rdp.main', channel:'rdp',
 *                  requestId, payload:{ method, payload } }`
 *   宿主 → 页面：`{ source:'obox-app', action:'obox-extension-reply', requestId,
 *                  result:{ ok:true, data } | { ok:false, error } }`
 *   本入口的 handler 返回值就是那个 `result`（宿主把它放进 reply 的 `data` 字段）。
 *
 * 与 obox 宿主只有扩展 API 依赖关系；除注入的 `api` 外零运行期依赖。
 */
import { buildRdpText } from './lib/rdpFile.mjs'
import { fromDbRow, normalizeConnection, toDbRow, validateConnection } from './lib/connection.mjs'

/** App 卡片 id（宿主按它把子窗口消息路由到本扩展） */
const APP_ID = 'rdp.main'
/** 连接库（`<扩展>/data/rdp.db`，默认表名 `rdp`） */
const DB_NAME = 'rdp.db'
/** manifest 里静态声明的 IPC 通道 id */
const CHANNEL_ID = 'rdp.helper'
/** 密码在 api.secrets 里的键前缀 */
const SECRET_PREFIX = 'conn:'

/** 卡片图标（内联 SVG；设计 §3.5 本期不用 iconUrl） */
const CARD_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="13" rx="1.5"/><path d="M8 20.5h8M12 16.5v4"/><path d="M6 8.5h5"/></svg>'

/** 错误归一：任何抛出物 → 可读单行文本 */
function messageOf(err) {
  if (err instanceof Error) return err.message || err.name || '未知错误'
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/** 0/1/'1'/true 都算真（界面勾选框按 0/1 提交，与界面 `fields.js` 的 truthy 同一口径） */
function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1'
}

/**
 * secrets 异常文本的兜底脱敏：把**已知密码**从文案里擦掉，再交给界面/日志。
 *
 * 宿主的 `api.secrets` 异常理论上不含明文，但它的 message 由底层实现决定、不受本扩展控制；
 * 一旦它把值带进 message，就会经 `fail()` 的回包进控制台日志（`console.error`；界面自 1.0.3 起
 * 不显示任何提示）。有值就擦，没值原样返回。
 */
function secretErrorText(err, secret) {
  const text = messageOf(err)
  const value = typeof secret === 'string' ? secret : ''
  return value ? text.split(value).join('***') : text
}

/** 成功应答 */
function ok(data) {
  return { ok: true, data: data === undefined ? null : data }
}

/** 失败应答（handler 不抛错——桥的 reply 信封越简单越好排查） */
function fail(error) {
  return { ok: false, error: messageOf(error) }
}

/** id 归一：正整数才算有效（界面的临时 id `temp-…` 不会被送到这里） */
function toId(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * 请求解析：`channel` 即方法名，`payload` 即参数（消息桥契约，见 `src/bridge.js`）。
 * 同时兼容"方法写在 payload 里"的字面写法（设计 §3.2 的 `{ method, payload }`）。
 */
function resolveRequest(channel, payload) {
  if (payload && typeof payload === 'object' && typeof payload.method === 'string') {
    return { method: payload.method, params: payload.payload === undefined ? {} : payload.payload }
  }
  return {
    method: typeof channel === 'string' ? channel : '',
    params: payload === undefined ? {} : payload
  }
}

/** save 的参数既可直接是连接对象，也可包一层 `{ connection }` */
function connectionInput(params) {
  if (
    params &&
    typeof params === 'object' &&
    params.connection &&
    typeof params.connection === 'object'
  ) {
    return params.connection
  }
  return params
}

/** 按 createdAt 升序（同刻按 id 升序）；ISO 字符串可直接字典序比较 */
function sortByCreatedAt(rows) {
  return [...rows].sort((a, b) => {
    const ca = String(a?.createdAt ?? '')
    const cb = String(b?.createdAt ?? '')
    if (ca !== cb) return ca < cb ? -1 : 1
    return Number(a?.id ?? 0) - Number(b?.id ?? 0)
  })
}

/**
 * 扩展入口。
 * @param {import('../../../src/api').ExtensionActivationApi} api 宿主注入的能力面
 * @returns {() => void} cleanup（注销卡片与消息处理器、断开 helper 通道）
 */
export default function rdp(api) {
  // ---- 数据库句柄（memo；失败后允许下次重试） ----
  let dbPromise = null
  function openDb() {
    if (!dbPromise) {
      dbPromise = Promise.resolve(api.sqlite.open(DB_NAME)).catch((err) => {
        dbPromise = null
        throw err
      })
    }
    return dbPromise
  }

  // ---- helper 通道（懒连接：激活扩展不该顺手拉起子进程） ----
  let connecting = null
  let connected = false
  function ensureHelper() {
    if (!connecting) {
      connecting = Promise.resolve(api.ipc.connect(CHANNEL_ID))
        .then(() => {
          connected = true
        })
        .catch((err) => {
          connecting = null
          throw err
        })
    }
    return connecting
  }
  async function callHelper(method, params) {
    await ensureHelper()
    // 显式给 60s：非默认端口要写两条 TERMSRV 目标串，helper 单次 cmdkey 上限 15s、最坏 30s，
    // 而宿主 api.ipc 的默认超时是 30s——不显式放宽的话宿主会先报 timeout，而 helper 仍在写凭据/拉起 mstsc。
    const reply = await api.ipc.request(CHANNEL_ID, method, params, { timeoutMs: 60000 })
    // 真机排查用：空回复是最难查的一种（调用方拿 `result?.x` 会静默变成 undefined）
    if (reply === undefined || reply === null) {
      console.warn(`[rdp] ipc ${method} 返回空值（通道可能没真正连上）`)
    }
    return reply
  }

  // 通道异常关闭（helper 崩溃/被杀）后允许下次调用重连
  const offClose =
    typeof api.ipc.onClose === 'function'
      ? api.ipc.onClose(CHANNEL_ID, () => {
          connecting = null
          connected = false
        })
      : null

  // ---- 方法实现 ----

  /**
   * 读已保存的密码：`open` 与 `password` **唯一**的读取入口（同一个键 `conn:<id>`、同一套容错口径，
   * 避免两处漂移）。
   *
   * 容错口径：读到空（`undefined` / `null`）与**读取抛错**都归一成空串 + `error`，且这里
   * **不打印任何东西**——密码明文只允许出现在返回值里（`open` 交给 helper 写 cmdkey，
   * `password` 交给界面回填密码框）。是否提示由调用方决定（`open` 记 warning，`password` 静默）。
   *
   * @param {number} id 连接 id（已过 `toId` 校验）
   * @returns {Promise<{ password: string, error: unknown }>}
   */
  async function readStoredPassword(id) {
    try {
      const value = await api.secrets.get(`${SECRET_PREFIX}${id}`)
      return { password: value === undefined || value === null ? '' : String(value), error: null }
    } catch (err) {
      return { password: '', error: err }
    }
  }

  /** list：全部连接，按 createdAt 升序 */
  async function list() {
    const db = await openDb()
    const rows = await db.get_all()
    return ok(sortByCreatedAt(Array.isArray(rows) ? rows : []).map(fromDbRow))
  }

  /** save：校验 → insert/update → 按 remember 写/删密码 */
  async function save(params) {
    const db = await openDb()
    const rows = await db.get_all()
    const existingRows = Array.isArray(rows) ? rows : []
    const input = connectionInput(params)
    const conn = normalizeConnection(input)
    // 「编辑时把密码框清空」是界面显式声明的意图（`clearPassword: 1`）：界面只有在**确实回填过**
    // 已存密码、而现在该框被清空时才会发它（判定在界面 src/fields.js 的 passwordCleared）。
    // ⚠️ 必须从**原始入参**读：`normalizeConnection` 只保留已知列，未知键会被丢掉。
    // 单独一个"密码为空"**不算**清空——否则"只改其它字段、没碰密码"就会被误删（见 test/passwordBackfill.test.js）。
    const clearPassword = isTruthyFlag(input?.clearPassword)

    // 先确认待编辑的行还在，再校验（否则"名字已存在"这种文案会盖掉更准确的"连接不存在"）
    const target =
      conn.id === undefined
        ? null
        : (existingRows.find((item) => String(item?.id) === String(conn.id)) ?? null)
    if (conn.id !== undefined && !target) return fail('连接不存在（可能已被删除），请刷新列表')

    const checked = validateConnection(conn, existingRows)
    if (!checked.ok) return fail(checked.errors.map((e) => e.message).join('；'))

    const now = new Date().toISOString()
    let row
    if (conn.id !== undefined) {
      const patch = toDbRow(conn, { updatedAt: now })
      delete patch.id
      await db.update({ id: conn.id }, patch)
      row = await db.get(conn.id)
    } else {
      row = await db.insert(toDbRow(conn, { createdAt: now, updatedAt: now }))
    }

    const key = `${SECRET_PREFIX}${row.id}`
    if (conn.remember && conn.password) {
      try {
        await api.secrets.set(key, conn.password)
      } catch (err) {
        // 连接已入库，但密码没存住：如实报错（连接时可手动输入密码）。
        // 文案里的底层错误先擦掉密码明文（异常文本不受本扩展控制，不能让它带上值）。
        return fail(
          `连接已保存，但密码未保存（${secretErrorText(err, conn.password)}）——连接时可能需要手动输入密码`
        )
      }
    } else if (!conn.remember || clearPassword) {
      // 两条删除口径：① 取消「记住密码」；② 编辑时把密码框清空（界面显式声明的 clearPassword）。
      // 注意删除的只是 `conn:<id>` 这条 secret；Windows 凭据管理器里的 cmdkey 条目要等下次
      // 成功写入覆盖、或删除连接时由 helper 清理（与 `remember=false` 同一条既有口径）。
      try {
        await api.secrets.delete(key)
      } catch (err) {
        console.warn('[rdp] 清理已保存的密码失败：', messageOf(err))
      }
    }
    return ok(fromDbRow(row))
  }

  /** remove：helper 清凭据（非致命）→ secrets 清理 → 删库行 */
  async function remove(params) {
    const id = toId((params ?? {}).id)
    if (id === null) return fail('remove 需要合法的 id')
    const db = await openDb()
    const row = await db.get(id)
    const warnings = []

    if (row) {
      try {
        const result = await callHelper('deleteCredential', { host: row.host, port: row.port })
        if (result && Array.isArray(result.warnings)) warnings.push(...result.warnings)
      } catch (err) {
        warnings.push(`本机凭据未清理：${messageOf(err)}`)
      }
    }
    try {
      await api.secrets.delete(`${SECRET_PREFIX}${id}`)
    } catch (err) {
      warnings.push(`已保存的密码未清理：${messageOf(err)}`)
    }
    await db.del(id)
    return ok({ id, warnings })
  }

  /** open：取密码（可空）→ 生成 .rdp → helper 预置凭据并经 cmd /c start 派发 mstsc */
  async function open(params) {
    const id = toId((params ?? {}).id)
    if (id === null) return fail('open 需要合法的 id')
    const db = await openDb()
    const row = await db.get(id)
    if (!row) return fail('连接不存在（可能已被删除），请刷新列表')

    const conn = fromDbRow(row)
    const warnings = []
    let credential = null
    // 与 `password` 方法同一个读取入口（同键、同容错口径）；读不到就当没有凭据
    const stored = await readStoredPassword(id)
    if (stored.error) warnings.push(`读取已保存的密码失败：${messageOf(stored.error)}`)
    if (stored.password) {
      credential = {
        host: conn.host,
        port: conn.port,
        user: conn.username,
        pass: stored.password,
        domain: conn.domain
      }
    }

    const rdpText = buildRdpText(normalizeConnection(row))
    const result = await callHelper('launch', {
      rdpText,
      fileName: `${id}.rdp`,
      credential
    })
    if (result && Array.isArray(result.warnings)) warnings.push(...result.warnings)
    // 判据换成"helper 有没有真的派发成功"：helper 失败时**抛错**（JSON-RPC error），走不到这里；
    // 能走到这里且 reply 是对象 ⇒ 已派发。**不再要求 pid**——经 cmd /c start 派发时 mstsc
    // 不是我们的子进程，拿不到 pid（见 docs/adr/0003）；`pid` 字段保留只是不改既有契约（恒 null）。
    if (!result || typeof result !== 'object') {
      let raw
      try {
        raw = JSON.stringify(result)
      } catch {
        raw = String(result)
      }
      console.warn('[rdp] launch 回复不是对象，helper 原始回复：', raw)
      return fail(`未能拉起 mstsc.exe（helper 回复：${raw ?? '空'}）`)
    }
    return ok({ pid: result.pid ?? null, path: result.path ?? null, warnings })
  }

  /** probe：透传 helper 的环境信息（界面「环境检查」） */
  async function probe() {
    return ok(await callHelper('probe', {}))
  }

  /**
   * password：把已保存的密码取给界面（编辑连接时回填密码框，默认仍是掩码，可点眼睛看明文）。
   *
   * - 入参 `{ id }`（`toId` 校验）；返回 `{ password }`（字符串，读不到就是空串）；
   * - 只读 `api.secrets` 的 `conn:<id>`（与 `open` 共用一个 `readStoredPassword`，键与容错口径都一致）；
   * - **取不到 / 读取异常一律返回空串且不报错**：读不到密码不该挡住编辑（用户重新输入即可）；
   * - **绝不打印**：本方法与 `readStoredPassword` 里没有任何 console 调用，密码只经返回值进界面；
   *   `save` 的失败文案会经 `secretErrorText` 擦掉明文，卡片列表（`list`）根本不碰 secrets。
   */
  async function password(params) {
    const id = toId((params ?? {}).id)
    if (id === null) return fail('password 需要合法的 id')
    const stored = await readStoredPassword(id)
    return ok({ password: stored.password })
  }

  // ---- 注册 ----

  const card = api.app.register({
    id: APP_ID,
    name: '远程桌面',
    version: '1.0.4',
    author: 'chenzhi',
    description: 'RDP 连接管理：卡片列表 / 新建 / 编辑 / 删除确认 / 打开（mstsc）',
    icon: CARD_ICON,
    url: new URL('./ui/index.html', new URL('.', import.meta.url)).href,
    multiOpen: false,
    width: 1024,
    height: 720
  })

  const offMessage = api.app.onMessage(async (channel, payload) => {
    const { method, params } = resolveRequest(channel, payload)
    try {
      switch (method) {
        case 'list':
          return await list()
        case 'save':
          return await save(params)
        case 'remove':
          return await remove(params)
        case 'open':
          return await open(params)
        case 'probe':
          return await probe()
        case 'password':
          return await password(params)
        default:
          return fail(`未知方法: ${String(method)}`)
      }
    } catch (err) {
      console.error(`[rdp] ${method} 失败`, err)
      return fail(err)
    }
  })

  return () => {
    offClose?.dispose()
    offMessage.dispose()
    card.dispose()
    if (connected) {
      connected = false
      void Promise.resolve(api.ipc.close(CHANNEL_ID)).catch(() => {})
    }
  }
}

/**
 * 卸载钩子（设计 §3.2 / R-B10）：删除本扩展写入的全部 secrets（宿主不清 secrets）。
 *
 * `api.secrets` **没有列表接口**，因此做法是：打开 `rdp.db` 读出全部连接 id，
 * 逐个 `delete('conn:<id>')`（键前缀固定为 `conn:`，见 `SECRET_PREFIX`）。
 * 库打不开（例如已被删除或从未建表）时无 id 可枚举，只能跳过并记日志——
 * 这也是"把 id 列表存进库里"这一替代方案的代价所现：本扩展选择以库为唯一事实来源。
 *
 * @param {{ api?: object }} ctx 宿主传入的钩子上下文（与激活同一套能力面）
 */
export async function uninstall(ctx) {
  const api = ctx?.api
  if (!api?.secrets || !api?.sqlite) return

  let rows = []
  try {
    const db = await api.sqlite.open(DB_NAME)
    rows = await db.get_all()
    await db.close()
  } catch (err) {
    console.warn('[rdp] uninstall 读取连接列表失败，跳过 secrets 清理：', messageOf(err))
    return
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.id === undefined || row?.id === null) continue
    try {
      await api.secrets.delete(`${SECRET_PREFIX}${row.id}`)
    } catch (err) {
      console.warn(`[rdp] uninstall 删除 ${SECRET_PREFIX}${row.id} 失败：`, messageOf(err))
    }
  }
}
