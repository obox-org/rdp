/**
 * `cmdkey` 参数拼装（纯函数，零依赖；设计 §3.3「目标串策略」）。
 *
 * 微软官方只说明凭据目标串形如 `TERMSRV/<主机>`；**非默认端口**下目标串要不要带端口
 * **官方未确认**，因此策略是"两条都写"：`TERMSRV/<主机>` 与 `TERMSRV/<主机>:<端口>`，
 * 以 `cmdkey /list` 核对（README 已标注为未官方确认项）。
 *
 * 本模块只拼参数数组，不执行命令（执行与超时在 helper.cjs）。
 */
import { DEFAULT_PORT } from './rdpFile.mjs'

/** 目标串前缀（RDP 的凭据目标类型） */
export const TERMSRV_PREFIX = 'TERMSRV/'

/** 主机归一：去空白；拒绝双引号（会破坏 cmdkey 的自解析命令行）与不可见字符 */
function normalizeHost(host) {
  const h = String(host ?? '').trim()
  if (!h) throw new Error('cmdkey 目标串需要非空主机')
  if (/["\r\n\t]/.test(h)) throw new Error(`主机名不能包含引号或控制字符: ${h}`)
  return h
}

/** 端口归一：空值取默认端口 */
function normalizePort(port) {
  if (port === '' || port === null || port === undefined) return DEFAULT_PORT
  const n = Number(port)
  return Number.isFinite(n) ? Math.trunc(n) : DEFAULT_PORT
}

/**
 * 凭据目标串数组：默认端口 1 条，非默认端口 2 条（见文件头）。
 * @returns {string[]}
 */
export function credentialTargets(host, port = DEFAULT_PORT) {
  const h = normalizeHost(host)
  const p = normalizePort(port)
  const targets = [`${TERMSRV_PREFIX}${h}`]
  if (p !== DEFAULT_PORT) targets.push(`${TERMSRV_PREFIX}${h}:${p}`)
  return targets
}

/**
 * cmdkey 的 `/user:` 取值：有域时写 `DOMAIN\user`（设计 §3.3），否则原样。
 * 用户名与域都为空是允许的（连接仍可连，只是 cmdkey 存的凭据没有用户名）。
 */
export function credentialUser(username, domain) {
  const user = String(username ?? '').trim()
  const dom = String(domain ?? '').trim()
  if (/["\r\n\t]/.test(user) || /["\r\n\t]/.test(dom)) {
    throw new Error('用户名/域不能包含引号或控制字符')
  }
  return dom ? `${dom}\\${user}` : user
}

/**
 * cmdkey 的值转义（真机实测结论，别改成其它写法）。
 *
 * cmdkey **会重新解析自己的命令行**：`/pass:` 的值里带空格会被截断，于是它认为缺少
 * `/user:`，报 "This command requires either the /U switch and a username" 并 exit 1
 * （实测 `/pass:pass word` 失败、`/pass:Simple123` 成功）。
 *
 * 正确修法：**含空白时把整个值用双引号包起来，内部双引号翻倍**（实测 `/pass:"pass word"`
 * 与 `/pass:"p@ss w""ord"` 都能成功）。
 *
 * ⚠️ 不要用"看起来能过"的替代方案：URL 编码（`%20`）、反斜杠转义等会让命令**成功返回**但
 * 把**错误的字面值**存进凭据管理器（实测 `/pass:pass%20word` 返回成功，存进去的是
 * `pass%20word`）——那是静默的错误密码，比失败更糟。
 * 含制表符等其它空白时 cmdkey 仍会失败（实测），那种情况由上层降级为"不预置凭据、由
 * Windows 弹框输入"。
 */
export function quoteForCmdkey(value) {
  const v = String(value ?? '')
  // 判据是**空白或双引号**：只判空白会漏掉 `a"b` 这种"无空白但含引号"的值，
  // 而 helper 用 windowsVerbatimArguments 传参（已放弃 Node 兜底转义），漏掉就会破坏 cmdkey 解析。
  if (!/[\s"]/.test(v)) return v
  return `"${v.replace(/"/g, '""')}"`
}

/**
 * `cmdkey /generic:<目标> /user:<用户> /pass:<密码> ...` 的参数数组（每个目标一条）。
 * helper 逐条 `execFile('cmdkey', args)` 并带超时。
 * @returns {Array<{ target: string, args: string[] }>}
 */
export function storeCredentialArgs({ host, port, username, password, domain } = {}) {
  const user = quoteForCmdkey(credentialUser(username, domain))
  const pass = quoteForCmdkey(String(password ?? ''))
  return credentialTargets(host, port).map((target) => ({
    target,
    args: [`/generic:${target}`, `/user:${user}`, `/pass:${pass}`]
  }))
}

/**
 * `cmdkey /delete:<目标>` 的参数数组（同样"两条都试"；条目不存在不算失败，由 helper 判定）。
 * @returns {Array<{ target: string, args: string[] }>}
 */
export function deleteCredentialArgs({ host, port } = {}) {
  return credentialTargets(host, port).map((target) => ({
    target,
    args: [`/delete:${target}`]
  }))
}
