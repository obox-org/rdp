/**
 * `.rdp` 文本生成（纯函数，零依赖；字段表严格照设计文档 §3.6）。
 *
 * - 行格式 `名称:类型:值`，行尾 **CRLF**（含最后一行），UTF-8 写出（helper 负责写盘）。
 * - 只写**非默认值**或用户显式设置的值 + 必填键（`full address:s:`）。
 * - `password 51:b:` **绝不写**（密码走 `cmdkey`，见 lib/cmdkeyArgs.mjs / helper.cjs）；
 *   `connection type:i:` 与 `desktopscalefactor:i:` 不进本实现。
 * - 字段名（`field`）与界面 `extensions/rdp/src/fields.js` 的 key 一一对应，
 *   也就是 `api.sqlite` 扁平列名——改名必须两边同步。
 */

/** 默认 RDP 端口（`.rdp` 的 `full address` 与 cmdkey 目标串都以它为"不带端口"的判据） */
export const DEFAULT_PORT = 3389

/**
 * 值转义防护。
 *
 * `.rdp` **没有转义语法**：反斜杠是字面量（`drivestoredirect:s:C:\;E:\;` 就依赖它），
 * 因此不能对 `\` 做转义。唯一要防的是**换行**——一个含 `\r\n` 的值能凭空注入额外的键
 * （例如伪造 `password 51:b:` 或覆盖 `full address`），所以换行一律折叠成空格。
 */
export function escapeRdpValue(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ')
}

/** 布尔/0-1 归一（界面按 0/1 提交，数据库按 boolean 还原） */
export function toBool(value) {
  return value === true || value === 1 || value === '1'
}

/** 整数归一：空值回退默认，非数字回退默认，浮点截断 */
export function toInt(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/**
 * `.rdp` 字段表（设计 §3.6，行序即写出顺序）。
 *
 * - `type: 'string'`：空串即"未设置"→ 不写；`rdpDefault`（若给出）也是"不写"的取值；
 *   `def` 是存储默认值。
 * - `type: 'bool'`：存储为布尔，写出 `onValue`/`offValue`（默认 1/0）；
 *   **布尔项一律显式写出**（见 `fieldValue` 的 bool 分支，它**不比较** `rdpDefault`）⇒
 *   布尔项上的 `rdpDefault` 只是"官方默认值"的记录，**不参与省略判断**，因此"本扩展默认 ≠
 *   官方默认"不会产生"省略该键 ⇒ 回落到官方默认"的静默偏差（这正是 `screen mode id` 踩过的坑）。
 * - `type: 'int'`：整数；等于 `rdpDefault`（缺省取 `def`）就不写。
 *
 * **本扩展默认 ≠ 官方默认**的布尔项（来源：Microsoft Learn *Supported RDP properties*，
 * 2026-05-16 版；旧版《Supported Remote Desktop RDP file settings》在 redirectclipboard /
 * redirectcomports 两行上的默认值与新版不同，取新版）：`smart sizing`（官方 0 / 本扩展 1）、
 * `redirectclipboard`（官方 0 / 本扩展 1）、`redirectcomports`、`redirectsmartcards`、
 * `redirectwebauthn`（官方 1 / 本扩展 0）、`remoteapplicationmode`（官方 1 / 本扩展 0）。
 * 逐条理由写在对应字段上；因为布尔项显式写出，这几处差异都会**真的落到文件里**。
 */
export const RDP_FIELDS = [
  { key: 'username:s:', field: 'username', type: 'string', def: '' },
  { key: 'domain:s:', field: 'domain', type: 'string', def: '' },
  {
    key: 'prompt for credentials:i:',
    field: 'promptForCredentials',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    // 官方默认是 **3**（"No authentication requirement specified."），本扩展默认取 **2**
    // （"验证失败时警告"，见 src/fields.js 的 AUTH_LEVELS）——所以 `rdpDefault: 3` 而 `def: 2`：
    // 缺省时也会**显式写出 `authentication level:i:2`**。旧写法（不写 rdpDefault ⇒ 比较值 = def = 2）
    // 会把用户看到的"默认警告"省略掉，mstsc 于是用官方默认 3 —— "界面说警告、实际一声不吭"，
    // 与 `screen mode id` 那条是同一类坑（省略 ≠ 本扩展默认）。
    key: 'authentication level:i:',
    field: 'authenticationLevel',
    type: 'int',
    def: 2,
    rdpDefault: 3
  },
  { key: 'enablecredsspsupport:i:', field: 'nla', type: 'bool', def: true, rdpDefault: 1 },
  {
    key: 'administrative session:i:',
    field: 'adminSession',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    key: 'autoreconnection enabled:i:',
    field: 'autoReconnect',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    // 真机实测结论：`.rdp` 里**不写** `screen mode id` 时，mstsc 的默认是 **2（全屏）**。
    // 所以这里**故意不设 `rdpDefault`**（bool 分支的兜底比较值是 0，而取值只有 1/2）→
    // 无论勾没勾都显式写出来：勾 = `2` 全屏、不勾 = `1` 窗口。
    // 曾经的写法是 `rdpDefault: 1`（按"窗口是默认"处理），于是取消勾选时该键被省略，
    // mstsc 回落到自己的全屏默认——用户看到的现象正是"把全屏去掉反而还是全屏"。
    key: 'screen mode id:i:',
    field: 'fullscreen',
    type: 'bool',
    def: false,
    onValue: 2,
    offValue: 1
  },
  {
    // 真机实测：`use multimon:i:1`（使用我的所有显示器）**只在全屏下有意义**，
    // 它会让 mstsc 忽略 `screen mode id:i:1`（窗口）而跨屏全屏启动。
    // 所以标记 `requires: 'fullscreen'`：全屏关掉时这个键**不写**，
    // 避免出现"库里 fullscreen=0 却仍全屏"的矛盾组合。
    // ⚠️ 官方文档对 `use multimon` 的默认值**两版不一致**（当前页写 1、旧版表写 0），
    // 所以这里**不断言"不写就等价于 0"**：本扩展只是"不写该键"，是否该显式写 `use multimon:i:0`
    // 待真机验证（README 未验证项）；本扩展默认取 0（= 单显示器）是设计 §3.6 的取舍。
    key: 'use multimon:i:',
    field: 'multimon',
    type: 'bool',
    def: false,
    requires: 'fullscreen',
    rdpDefault: 0
  },
  { key: 'desktopwidth:i:', field: 'desktopWidth', type: 'int', def: 1280 },
  { key: 'desktopheight:i:', field: 'desktopHeight', type: 'int', def: 800 },
  {
    // 官方默认 0（不随窗口缩放），本扩展默认 **1**：本扩展的主用法是"窗口模式用桌面"，
    // 窗口一缩放就出现滚动条/黑边比"画面不跟随"更糟。布尔项一律显式写出 ⇒ 官方默认不生效。
    key: 'smart sizing:i:',
    field: 'smartSizing',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'dynamic resolution:i:',
    field: 'dynamicResolution',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  { key: 'session bpp:i:', field: 'sessionBpp', type: 'int', def: 32 },
  { key: 'selectedmonitors:s:', field: 'selectedMonitors', type: 'string', def: '' },
  {
    key: 'maximizetocurrentdisplays:i:',
    field: 'maximizeToCurrentDisplays',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    key: 'singlemoninwindowedmode:i:',
    field: 'singleMonInWindowedMode',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  { key: 'audiomode:i:', field: 'audioMode', type: 'int', def: 0 },
  {
    key: 'audiocapturemode:i:',
    field: 'audioCaptureMode',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    // 官方默认 0（默认**不**共享剪贴板），本扩展默认 **1**：剪贴板互通是这个管理器的主要用途
    // （把本机/远程的文本搬来搬去）。注意 README §11：Windows 2026-04 起会弹"连接安全"框，
    // 里面**默认全不勾**——本键只让剪贴板成为可选项，不等于替用户勾上。
    key: 'redirectclipboard:i:',
    field: 'clipboard',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'redirectprinters:i:',
    field: 'redirectPrinters',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    // 官方默认 1（默认重定向 COM 口），本扩展默认 **0**：串口是少数设备的刚需，
    // 默认不把本机硬件暴露给远程（最小权限）。布尔项一律显式写出 ⇒ 官方默认不生效。
    key: 'redirectcomports:i:',
    field: 'redirectComPorts',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    // 官方默认 1（默认重定向智能卡），本扩展默认 **0**：同上取最小权限，需要时在高级区打开。
    key: 'redirectsmartcards:i:',
    field: 'redirectSmartCards',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    key: 'redirectlocation:i:',
    field: 'redirectLocation',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    // 官方默认 1（默认重定向 WebAuthn），本扩展默认 **0**：不让远程会话直接调用本机的
    // Windows Hello/安全密钥，需要时在高级区打开（最小权限）。
    key: 'redirectwebauthn:i:',
    field: 'redirectWebAuthn',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  { key: 'drivestoredirect:s:', field: 'driveStoreDirect', type: 'string', def: '' },
  { key: 'usbdevicestoredirect:s:', field: 'usbDeviceStoreDirect', type: 'string', def: '' },
  {
    key: 'devicestoredirect:s:',
    field: 'deviceStoreDirect',
    type: 'string',
    def: '*',
    rdpDefault: '*'
  },
  { key: 'camerastoredirect:s:', field: 'cameraStoreDirect', type: 'string', def: '' },
  { key: 'keyboardhook:i:', field: 'keyboardHook', type: 'int', def: 2 },
  {
    key: 'networkautodetect:i:',
    field: 'networkAutoDetect',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'bandwidthautodetect:i:',
    field: 'bandwidthAutoDetect',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  { key: 'compression:i:', field: 'compression', type: 'bool', def: true, rdpDefault: 1 },
  {
    key: 'videoplaybackmode:i:',
    field: 'videoPlaybackMode',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'bitmapcachepersistenable:i:',
    field: 'bitmapCachePersistEnable',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'disable wallpaper:i:',
    field: 'disableWallpaper',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    key: 'allow font smoothing:i:',
    field: 'allowFontSmoothing',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'allow desktop composition:i:',
    field: 'allowDesktopComposition',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'disable full window drag:i:',
    field: 'disableFullWindowDrag',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    key: 'disable menu anims:i:',
    field: 'disableMenuAnims',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  { key: 'disable themes:i:', field: 'disableThemes', type: 'bool', def: false, rdpDefault: 0 },
  {
    key: 'disable cursor setting:i:',
    field: 'disableCursorSetting',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  { key: 'gatewayhostname:s:', field: 'gatewayHostname', type: 'string', def: '' },
  { key: 'gatewayusagemethod:i:', field: 'gatewayUsageMethod', type: 'int', def: 3 },
  {
    // 官方取值 **0–5 已确证**（询问密码 NTLM / 智能卡 / 当前登录用户凭据 / 提示输入凭据+基本认证 /
    // 稍后选择 / 基于 Cookie；来源见 test/fieldDocs.test.js 的 OFFICIALLY_CONFIRMED），界面已改为
    // **下拉框**（src/fields.js 的 GATEWAY_CREDENTIALS，官方 6 个取值之外多一个"留空（不写该键）"）；
    // 因此这里的 `type: 'string'` 只是"没有非空默认值、留空就不写"的存储口径，
    // 值由界面保证是 0–5 之一或空串（旧版自由文本 + "未官方确认"角标已删除）。
    key: 'gatewaycredentialssource:i:',
    field: 'gatewayCredentialsSource',
    type: 'string',
    def: ''
  },
  {
    key: 'promptcredentialonce:i:',
    field: 'promptCredentialOnce',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'negotiate security layer:i:',
    field: 'negotiateSecurityLayer',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'disableconnectionsharing:i:',
    field: 'disableConnectionSharing',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    key: 'enablerdsaadauth:i:',
    field: 'enableRdsAadAuth',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  { key: 'alternate shell:s:', field: 'alternateShell', type: 'string', def: '' },
  { key: 'shell working directory:s:', field: 'shellWorkingDirectory', type: 'string', def: '' },
  {
    // 官方默认 1（官方那份表面向"服务端发布的 RemoteApp 文件"），本扩展默认 **0**：
    // 本扩展的主用法是整桌面连接，RemoteApp 是少数场景（打开开关才展开下面各项）。
    key: 'remoteapplicationmode:i:',
    field: 'remoteApplicationMode',
    type: 'bool',
    def: false,
    rdpDefault: 0
  },
  {
    key: 'remoteapplicationprogram:s:',
    field: 'remoteApplicationProgram',
    type: 'string',
    def: ''
  },
  { key: 'remoteapplicationname:s:', field: 'remoteApplicationName', type: 'string', def: '' },
  {
    key: 'remoteapplicationcmdline:s:',
    field: 'remoteApplicationCmdLine',
    type: 'string',
    def: ''
  },
  { key: 'remoteapplicationfile:s:', field: 'remoteApplicationFile', type: 'string', def: '' },
  { key: 'remoteapplicationicon:s:', field: 'remoteApplicationIcon', type: 'string', def: '' },
  { key: 'remoteapplicationguid:s:', field: 'remoteApplicationGuid', type: 'string', def: '' },
  {
    key: 'remoteapplicationexpandcmdline:i:',
    field: 'remoteApplicationExpandCmdLine',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  {
    key: 'remoteapplicationexpandworkingdir:i:',
    field: 'remoteApplicationExpandWorkingDir',
    type: 'bool',
    def: true,
    rdpDefault: 1
  },
  { key: 'loadbalanceinfo:s:', field: 'loadBalanceInfo', type: 'string', def: '' }
]

/** 字段名 → 字段定义 */
export const FIELD_BY_NAME = new Map(RDP_FIELDS.map((spec) => [spec.field, spec]))

/** 端口归一：空值取默认端口；其余保留（含非法值，交给 connection.mjs 校验挡下） */
export function toPort(value) {
  if (value === '' || value === null || value === undefined) return DEFAULT_PORT
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN
}

/**
 * `full address:s:` 的取值：端口是默认端口时只写主机（Windows 自己生成的 `.rdp` 就是这样），
 * 非默认端口写 `主机:端口`（与 cmdkey 的两条目标串策略、卡片标题口径一致）。
 */
export function formatFullAddress(host, port) {
  const h = String(host ?? '').trim()
  const p = toPort(port)
  return p === DEFAULT_PORT ? h : `${h}:${p}`
}

/**
 * 单个字段 → `.rdp` 行的值；返回 `null` 表示"等于默认值，不写这一行"。
 * 导出来是为了让单测能逐字段断言，不必拼整份文本。
 */
export function fieldValue(spec, conn) {
  if (spec.type === 'string') {
    const text = escapeRdpValue(conn?.[spec.field])
    if (text === '') return null
    // 少数字符串键本身有非空默认值（如 devicestoredirect 的 `*`）：等于默认值也不写
    if (spec.rdpDefault !== undefined && text === spec.rdpDefault) return null
    return text
  }
  if (spec.type === 'bool') {
    // 依赖项不成立（如 `use multimon` 需要 `fullscreen`）→ 不写该键
    if (spec.requires && !toBool(conn?.[spec.requires])) return null
    const raw = conn?.[spec.field]
    // 未提供的字段按 §3.6 的默认值处理（而不是"当成 false"，否则默认开的效果会被关掉）
    const on = raw === undefined || raw === null || raw === '' ? Boolean(spec.def) : toBool(raw)
    const value = on ? (spec.onValue ?? 1) : (spec.offValue ?? 0)
    // **布尔项一律显式写出**（不因"等于默认值"而省略）。真机踩过三次：
    //   ① 缺 `screen mode id` 时 mstsc 默认是**全屏**（用户"取消全屏"反而不生效）；
    //   ② `use multimon:i:1` 会让 mstsc 忽略窗口模式（已改成 requires 门控）；
    //   ③ 勾了"剪贴板"却因为 `redirectclipboard` 默认=1 而被省略，用户以为没生效。
    // 显式写出来既自证配置、也彻底不依赖各版本 mstsc 对缺省键的假设（文件只大几百字节）。
    // 结论：bool 项的 `spec.rdpDefault` **在本分支里不被读取**，它只是"官方默认值"的记录，
    // 所以"本扩展默认 ≠ 官方默认"的布尔项不会出现"省略后静默回落到官方默认"。
    return String(value)
  }
  const value = toInt(conn?.[spec.field], spec.def)
  return value === (spec.rdpDefault ?? spec.def) ? null : String(value)
}

/**
 * 连接配置 → `.rdp` 文本（CRLF 行尾，末尾也带 CRLF）。
 *
 * 必须传入已归一化的连接（`lib/connection.mjs` 的 `normalizeConnection`），
 * 且主机非空——否则 `.rdp` 里会落一个空的 `full address`（mstsc 直接报错）。
 */
export function buildRdpText(conn) {
  const host = String(conn?.host ?? '').trim()
  if (!host) throw new Error('buildRdpText 需要非空主机（请先经 lib/connection.mjs 校验）')

  const lines = [`full address:s:${escapeRdpValue(formatFullAddress(host, conn.port))}`]
  for (const spec of RDP_FIELDS) {
    const value = fieldValue(spec, conn)
    if (value !== null) lines.push(`${spec.key}${value}`)
  }
  return `${lines.join('\r\n')}\r\n`
}
