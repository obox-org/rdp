/**
 * 连接的校验、归一与序列化（纯函数，零依赖；设计 §3.4/§3.6/§3.9.2）。
 *
 * - 界面表单键 = `api.sqlite` 扁平列名 = `.rdp` 字段表里的 `field`（见 lib/rdpFile.mjs）。
 * - 字段取值范围/默认值与界面 `extensions/rdp/src/fields.js` 一致（改一处必须改两处）。
 * - 密码**不入库**（`api.secrets` 键 `conn:<id>`）：`toDbRow` 会丢掉 `password`。
 */
import { RDP_FIELDS, DEFAULT_PORT, formatFullAddress, toBool, toInt, toPort } from './rdpFile.mjs'

/** 连接元信息列（非 `.rdp` 键） */
export const META_FIELDS = ['id', 'name', 'host', 'port', 'username', 'domain', 'remember']

/** 时间戳列（由扩展在写入时补） */
export const TIMESTAMP_FIELDS = ['createdAt', 'updatedAt']

/** 字符串归一：去首尾空白（主机/域名/路径等都不该带空白），保留内部原样 */
function str(value) {
  return String(value ?? '').trim()
}

/**
 * 表单载荷 → 归一化连接（补默认值、归一到稳定类型）。
 *
 * 关键点：**所有列都产出具体值**——`api.sqlite` 的表列类型由首次 insert 的 JS 类型决定，
 * 漏字段（undefined→TEXT）会让后续写入类型漂移。
 */
export function normalizeConnection(input) {
  const src = input && typeof input === 'object' ? input : {}
  /** @type {Record<string, unknown>} */
  const conn = {}

  const id = Number(src.id)
  if (src.id !== undefined && src.id !== null && src.id !== '' && Number.isFinite(id)) conn.id = id

  conn.name = str(src.name)
  conn.host = str(src.host)
  conn.port = toPort(src.port)
  // 「记住密码」：缺省为**真**（与界面表单默认一致，且避免漏传该字段时把已存密码删掉）
  conn.remember =
    src.remember === undefined || src.remember === null || src.remember === ''
      ? true
      : toBool(src.remember)
  // 密码只在内存/载荷里流转，写库前被 toDbRow 丢掉
  conn.password = String(src.password ?? '')

  for (const spec of RDP_FIELDS) {
    const raw = src[spec.field]
    const missing = raw === undefined || raw === null
    if (spec.type === 'string') conn[spec.field] = missing ? spec.def : str(raw)
    else if (spec.type === 'bool') {
      conn[spec.field] = missing || raw === '' ? Boolean(spec.def) : toBool(raw)
    } else conn[spec.field] = toInt(raw, spec.def)
  }
  return conn
}

/**
 * 校验（设计 §3.9.2 的后端同款口径）：连接名非空且列表内唯一、主机非空、端口 1–65535。
 * @param {Record<string, unknown>} conn 归一化后的连接
 * @param {Array<Record<string, unknown>>} rows 现有行（判连接名唯一；编辑时按 id 排除自己）
 * @returns {{ ok: boolean, errors: Array<{ field: string, message: string }> }}
 */
export function validateConnection(conn, rows = []) {
  const errors = []
  const name = str(conn?.name)
  if (!name) {
    errors.push({ field: 'name', message: '连接名不能为空' })
  } else {
    const selfId = conn?.id === undefined ? '' : String(conn.id)
    const duplicated = (Array.isArray(rows) ? rows : []).some(
      (row) => str(row?.name) === name && (row?.id === undefined ? '' : String(row.id)) !== selfId
    )
    if (duplicated) errors.push({ field: 'name', message: `连接名「${name}」已存在，请换一个` })
  }

  if (!str(conn?.host)) errors.push({ field: 'host', message: '主机不能为空' })

  const port = conn?.port
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push({ field: 'port', message: '端口必须是 1–65535 的整数' })
  }

  return { ok: errors.length === 0, errors }
}

/** 卡片标题（设计 §3.9.1）：`username@host:port`；无用户名时退化为 `host:port` */
export function connectionTitle(conn) {
  const host = str(conn?.host)
  const port = toPort(conn?.port)
  const user = str(conn?.username)
  return `${user ? `${user}@` : ''}${host}:${port}`
}

/**
 * 归一化连接 → 数据库行（**只含表列**：丢掉 `password`，按需补时间戳）。
 * @param {Record<string, unknown>} conn
 * @param {{ createdAt?: string, updatedAt?: string }} [timestamps]
 */
export function toDbRow(input, timestamps = {}) {
  // 先归一：默认值只在这一处定义，避免"表列默认值"与"表单默认值"漂移
  const conn = normalizeConnection(input)
  /** @type {Record<string, unknown>} */
  const row = {
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    domain: conn.domain,
    remember: conn.remember
  }
  for (const spec of RDP_FIELDS) {
    if (spec.field === 'username' || spec.field === 'domain') continue
    row[spec.field] = conn[spec.field]
  }
  if (conn.id !== undefined) row.id = conn.id
  return { ...row, ...timestamps }
}

/**
 * 数据库行 → 界面用连接对象（保留原列，另附派生的 `title` 与 `address`）。
 * 注意：**不返回密码**——密码只在 `api.secrets` 里，界面永远拿不到。
 */
export function fromDbRow(row) {
  const source = row && typeof row === 'object' ? row : {}
  const conn = { ...source }
  conn.title = connectionTitle(source)
  conn.address = formatFullAddress(source.host, source.port ?? DEFAULT_PORT)
  return conn
}
