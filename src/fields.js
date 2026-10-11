/**
 * 表单字段表（设计文档 §3.6 `.rdp` 字段表的「常」/「高」行一一对应）。
 *
 * - key：提交给扩展（index.js → api.sqlite 扁平列）的字段名；勾选框按 0/1 整数提交。
 * - rdp：对应的 `.rdp` 键，仅作对照注释，页面不生成 `.rdp` 文本（那是 lib/rdpFile.mjs 的活）。
 * - type：text | number | password | check | select | pair
 *   **多选一的控件一律用 `select` 下拉框**（历史上音频用过 `radio`，现统一为下拉）；`pair` 是「宽×高」两格。
 * - desc：每项下方**一行**灰色说明；超长的一律改短句（UI 只给一行，见 §4.3）。
 * - options[].label：下拉项里跟在取值后面的**短说明**（选项文本形如 `2 — 仅全屏交给远程`）；
 *   options[].desc：同一取值的更细一句，作为该 `<option>` 的 `title`（悬浮提示），不占界面行。
 * - optional + emptyLabel：官方枚举之外的"空值态"。带 `optional` 的字段在下拉框最前面多一个
 *   空值选项（**不属于** `options`，所以"每个取值都有 desc"的覆盖率只统计官方取值）；
 *   当前只有 `gatewayCredentialsSource` 需要它（留空 ⇒ 不写该键 ⇒ mstsc 用官方默认 0）。
 * - badge：已**全部移除**——原先给"官方未确认"字段留的角标没有字段再用（`gatewaycredentialssource`
 *   已查到官方取值 0–5，改为下拉框）；守卫见 test/fieldDocs.test.js 与 test/componentSource.test.js。
 * - 可见性：字段自带的 `showIf`，或者 `VISIBILITY` 表按 key 命中（求值时合并，见 isFieldVisible）。
 */

/** 音频：audiomode（取值说明来自设计 §6.1，逐条对齐微软官方文档） */
const AUDIO_MODES = [
  { value: 0, label: '本地播放', desc: '声音从本机扬声器出（官方默认）。' },
  { value: 1, label: '远程播放', desc: '声音留在远程主机，本机听不到。' },
  { value: 2, label: '不播放', desc: '完全不传输声音，省带宽。' }
]

/**
 * 键盘钩子：keyboardhook（0 本机 / 1 桌面会话交给远程 / 2 仅全屏交给远程 / 3 RemoteApp 会话交给远程）
 *
 * 官方取值（Microsoft Learn *Supported RDP properties*，2026-05-16 版；同一页的旧版
 * 《Supported Remote Desktop RDP file settings》只列 0/1/2，**3 是后加的**）：
 *   0 组合键在本机生效；1（仅桌面会话）焦点在远程时交给远程；2（仅桌面会话）仅全屏时交给远程；
 *   3（**仅 RemoteApp 会话**）焦点在 RemoteApp 上时交给远程，且仅 Windows 客户端支持。
 * ⇒ 1 与 3 **不同义**：区别是会话类型（桌面 vs RemoteApp），不是"窗口/全屏"。原 label「始终交给远程」有误，已订正。
 */
const KEYBOARD_HOOKS = [
  { value: 0, label: '本机处理', desc: '所有组合键（含 Win 键）都由本机处理。' },
  { value: 1, label: '远程（桌面会话）', desc: '桌面会话中焦点在远程时把组合键交给远程。' },
  { value: 2, label: '仅全屏交给远程', desc: '桌面会话只有全屏时才交给远程（官方默认）。' },
  {
    value: 3,
    label: 'RemoteApp 会话交给远程',
    desc: '仅 RemoteApp 会话、且焦点在其上时交给远程。'
  }
]

/**
 * 认证级别：authentication level。
 *
 * ⚠️ **官方默认是 3（不要求身份验证），本扩展默认取 2（验证失败时警告）**，所以官方默认值
 * 这一栏不再标在 2 上；俩者的差别是"服务器身份验证失败时是否提示"，属安全口径取舍：
 * 本扩展取"警告"（更保守）。`.rdp` 侧因此**总是显式写出**（rdpFile.mjs 的 `rdpDefault: 3`）。
 */
const AUTH_LEVELS = [
  { value: 0, label: '不验证，直接连接', desc: '验证失败也直接连，最不安全。' },
  { value: 1, label: '验证失败则不连接', desc: '无法验证身份时拒绝连接，最严格。' },
  { value: 2, label: '验证失败时警告', desc: '警告后由用户决定是否继续（本扩展默认）。' },
  { value: 3, label: '不要求身份验证', desc: '不要求服务器提供身份证明（官方默认）。' }
]

/** 网关用法：gatewayusagemethod */
const GATEWAY_USAGE = [
  { value: 0, label: '不使用网关', desc: '完全不经过 RD 网关，直连目标主机。' },
  { value: 1, label: '始终使用', desc: '所有连接都经网关转发（含内网地址）。' },
  { value: 2, label: '自动检测', desc: '直连不通时才走网关。' },
  { value: 3, label: '使用默认设置', desc: '用系统/客户端的网关默认值（本扩展默认）。' },
  { value: 4, label: '本地地址绕过网关', desc: '内网地址直连，其余仍走网关。' }
]

/** 色深：session bpp（label 不重复取值数字——选项文本已是 `取值 — label`，如 `32 — 画质最好`） */
const SESSION_BPP = [
  { value: 8, label: '颜色最少', desc: '8 位色，带宽最省，但会有色带。' },
  { value: 16, label: '高彩', desc: '16 位色，颜色与带宽的折中。' },
  { value: 24, label: '真彩', desc: '24 位色，颜色更准、带宽更大。' },
  { value: 32, label: '画质最好', desc: '32 位色，画质最好、带宽最大（本扩展默认）。' }
]

/**
 * 网关凭据来源：gatewaycredentialssource（官方枚举 0–5）。
 * 来源：MicrosoftDocs/windowsserverdocs 的 RDP 设置表（PR #4510 合入，见 test/fieldDocs.test.js 的登记表）。
 */
const GATEWAY_CREDENTIALS = [
  { value: 0, label: '询问密码（NTLM）', desc: '连接时向用户询问网关密码（官方默认）。' },
  { value: 1, label: '智能卡', desc: '用本机智能卡完成网关认证。' },
  { value: 2, label: '当前登录用户凭据', desc: '直接用当前 Windows 登录凭据。' },
  { value: 3, label: '提示输入凭据 + 基本认证', desc: '提示输入凭据并用基本认证发送。' },
  { value: 4, label: '稍后由用户选择', desc: '连接时再由用户选择认证方式。' },
  { value: 5, label: '基于 Cookie 认证', desc: '用 Cookie 完成网关认证。' }
]

/** 表单值 → 布尔（0/1/'1'/true 都算真；表单里勾选框可能是布尔也可能是 0/1） */
function truthy(value) {
  return value === true || value === 1 || value === '1'
}

/** 非空文本：网关地址这类"填了才展开后续项"的前提 */
function nonEmpty(value) {
  return String(value ?? '').trim() !== ''
}

/** 常用区（§3.6 的「常」行） */
export const COMMON_GROUPS = [
  {
    title: '连接',
    fields: [
      {
        key: 'name',
        label: '连接名',
        type: 'text',
        required: true,
        placeholder: '生产跳板机',
        desc: '只在本扩展列表里标识这条连接，不写进 .rdp。'
      },
      {
        key: 'host',
        label: '主机',
        type: 'text',
        required: true,
        placeholder: '10.0.0.8',
        rdp: 'full address',
        desc: '目标地址，对应 full address；端口 3389 时只写主机。'
      },
      {
        key: 'port',
        label: '端口',
        type: 'number',
        def: 3389,
        min: 1,
        max: 65535,
        desc: '目标 RDP 端口，非 3389 时会额外存一条带端口的凭据。'
      },
      {
        key: 'username',
        label: '用户名',
        type: 'text',
        def: '',
        placeholder: 'chenzhi',
        rdp: 'username',
        desc: '登录账号，对应 username；开 Entra ID 认证时忽略。'
      },
      {
        key: 'domain',
        label: '域',
        type: 'text',
        def: '',
        placeholder: 'CORP',
        rdp: 'domain',
        desc: '账号所属域，对应 domain，用于「域\\用户」登录。'
      },
      {
        key: 'password',
        label: '密码',
        type: 'password',
        def: '',
        secret: true,
        // ⚠️ 说明必须压进**一行**：1280 窗口下常用区控件列宽 446px，这句实测 364.4px
        // （旧句「…不写 .rdp、不入库；编辑时清空即删除已存密码。」实测 449.2px，会折成两行）。
        // 语义仍是三条：只进本机凭据管理器、不写 .rdp / 不入库、清空即删除已存凭据。
        // 门禁见 test/formAlign.test.js 的 A1⑧（改长这句会直接变红）。
        desc: '只交本机凭据管理器（cmdkey），不写 .rdp / 不入库，清空即删除。'
      },
      {
        key: 'remember',
        label: '记住密码',
        type: 'check',
        def: true,
        keep: true,
        desc: '保存时把密码写入本机凭据；取消则删除旧凭据。'
      }
    ]
  },
  {
    title: '显示',
    fields: [
      {
        key: 'fullscreen',
        label: '全屏启动',
        type: 'check',
        def: false,
        rdp: 'screen mode id',
        desc: '勾选写 screen mode id:i:2，不勾写 i:1（缺该键 mstsc 默认全屏）。'
      },
      // 多显示器只在全屏下有意义（RDP 的 use multimon 仅全屏生效，且会让 mstsc 忽略窗口模式）：
      // 窗口模式时**整个选项不显示**（showIf 按当前表单求值，见 isFieldVisible）
      {
        key: 'multimon',
        label: '多显示器',
        type: 'check',
        def: false,
        rdp: 'use multimon',
        // 与 VISIBILITY 同一套 truthy 口径（L2：历史上这里是 !!form.fullscreen，与 REST 口径不同）
        showIf: (form) => truthy(form.fullscreen),
        desc: '在所有显示器上铺开远程桌面；只在全屏时显示。'
      },
      {
        key: 'resolution',
        label: '分辨率',
        type: 'pair',
        keys: ['desktopWidth', 'desktopHeight'],
        def: [1280, 800],
        min: 200,
        max: 8192,
        rdp: 'desktopwidth / desktopheight',
        desc: '窗口模式下的桌面宽×高，对应 desktopwidth / desktopheight。'
      },
      {
        key: 'smartSizing',
        label: '智能缩放',
        type: 'check',
        def: true,
        rdp: 'smart sizing',
        desc: '窗口缩放时等比缩放远程画面，不改远程分辨率。'
      },
      {
        key: 'dynamicResolution',
        label: '动态分辨率',
        type: 'check',
        def: true,
        rdp: 'dynamic resolution',
        desc: '窗口缩放时改远程分辨率去适应，画面清晰但会重排。'
      }
    ]
  },
  {
    title: '本地资源',
    fields: [
      {
        key: 'clipboard',
        label: '剪贴板',
        type: 'check',
        def: true,
        rdp: 'redirectclipboard',
        desc: '允许本机与远程互相复制粘贴（redirectclipboard）。'
      },
      {
        key: 'audioMode',
        label: '音频',
        type: 'select',
        def: 0,
        options: AUDIO_MODES,
        rdp: 'audiomode',
        desc: '远程声音在哪播放（audiomode 取 0/1/2）。'
      },
      {
        key: 'keyboardHook',
        label: '键盘钩子',
        type: 'select',
        def: 2,
        options: KEYBOARD_HOOKS,
        rdp: 'keyboardhook',
        desc: 'Windows 组合键由本机还是远程处理（keyboardhook 取 0–3）。'
      }
    ]
  },
  {
    title: '安全',
    fields: [
      {
        key: 'authenticationLevel',
        label: '认证级别',
        type: 'select',
        def: 2,
        options: AUTH_LEVELS,
        rdp: 'authentication level',
        desc: '身份验证失败时怎么办（authentication level 取 0–3）。'
      },
      {
        key: 'nla',
        label: 'NLA（网络级认证）',
        type: 'check',
        def: true,
        rdp: 'enablecredsspsupport',
        desc: '连接前先做凭据认证，降低中间人风险。'
      },
      {
        key: 'adminSession',
        label: '管理会话',
        type: 'check',
        def: false,
        rdp: 'administrative session',
        desc: '以管理会话登录（等价 mstsc /admin）；RemoteApp 模式下隐藏。'
      },
      {
        key: 'autoReconnect',
        label: '自动重连',
        type: 'check',
        def: true,
        rdp: 'autoreconnection enabled',
        desc: '网络闪断后自动重连原会话。'
      }
    ]
  }
]

/** 高级区（§3.6 的「高」行，五组） */
export const ADVANCED_GROUPS = [
  {
    title: '显示',
    fields: [
      {
        key: 'sessionBpp',
        label: '色深',
        type: 'select',
        def: 32,
        options: SESSION_BPP,
        rdp: 'session bpp',
        desc: '画面颜色位数，越高越准、带宽越大（session bpp 取 8/16/24/32）。'
      },
      {
        key: 'selectedMonitors',
        label: '指定显示器',
        type: 'text',
        def: '',
        placeholder: '全部显示器',
        hint: '显示器 ID 用 mstsc /l 查，多个用逗号分隔',
        rdp: 'selectedmonitors',
        desc: '只在选定显示器上全屏；留空表示全部；需先开全屏 + 多显示器。'
      },
      {
        key: 'maximizeToCurrentDisplays',
        label: '全屏时占满当前显示器',
        type: 'check',
        def: false,
        rdp: 'maximizetocurrentdisplays',
        desc: '全屏时铺满当前显示器，而不是跨全部显示器。'
      },
      {
        // 官方语义：多显示器会话**退出全屏**时是否自动切回单显示器（文档标注需 use multimon=1）。
        // 见 VISIBILITY 里 `singleMonInWindowedMode` 的说明：本扩展在**窗口模式**下显示它
        // （它描述的就是"退出全屏后"的行为），而不是像 R-D2 修复时那样恒隐藏。
        key: 'singleMonInWindowedMode',
        label: '窗口模式单显',
        type: 'check',
        def: false,
        rdp: 'singlemoninwindowedmode',
        desc: '多显示器会话退出全屏时是否只保留一个显示器（0 保留全部 / 1 切回单个）。'
      }
    ]
  },
  {
    title: '本地资源',
    fields: [
      {
        key: 'audioCaptureMode',
        label: '麦克风重定向',
        type: 'check',
        def: false,
        rdp: 'audiocapturemode',
        desc: '把本机麦克风带进远程会话供其录音。'
      },
      {
        key: 'redirectPrinters',
        label: '打印机',
        type: 'check',
        def: false,
        rdp: 'redirectprinters',
        desc: '让远程会话能用本机打印机。'
      },
      {
        key: 'redirectComPorts',
        label: 'COM 口',
        type: 'check',
        def: false,
        rdp: 'redirectcomports',
        desc: '把本机串口映射进远程会话。'
      },
      {
        key: 'redirectSmartCards',
        label: '智能卡',
        type: 'check',
        def: false,
        rdp: 'redirectsmartcards',
        desc: '让远程会话能读插在本机的智能卡。'
      },
      {
        key: 'redirectLocation',
        label: '位置',
        type: 'check',
        def: false,
        rdp: 'redirectlocation',
        desc: '把本机位置信息提供给远程会话。'
      },
      {
        key: 'redirectWebAuthn',
        label: 'WebAuthn',
        type: 'check',
        def: false,
        rdp: 'redirectwebauthn',
        desc: '让远程会话能用本机的 Windows Hello 等凭据。'
      },
      {
        key: 'driveStoreDirect',
        label: '驱动器',
        type: 'text',
        def: '',
        placeholder: '空 / * / DynamicDrives / C:\\;E:\\;',
        rdp: 'drivestoredirect',
        desc: '把本机磁盘映射进远程；* 全部、DynamicDrives 连接时插上的、也可列盘符。'
      },
      {
        key: 'usbDeviceStoreDirect',
        label: 'USB 重定向',
        type: 'text',
        def: '',
        rdp: 'usbdevicestoredirect',
        desc: '把本机 USB 设备重定向进远程：* 表示未被高级重定向接管的设备。'
      },
      {
        key: 'deviceStoreDirect',
        label: 'MTP/PTP 设备',
        type: 'text',
        def: '*',
        rdp: 'devicestoredirect',
        desc: '重定向便携设备（相机、手机等），默认 * 表示全部。'
      },
      {
        key: 'cameraStoreDirect',
        label: '摄像头',
        type: 'text',
        def: '',
        rdp: 'camerastoredirect',
        desc: '把本机摄像头重定向进远程：* 全部，某条前加 - 表示排除。'
      }
    ]
  },
  {
    title: '体验',
    fields: [
      {
        key: 'networkAutoDetect',
        label: '网络自动检测',
        type: 'check',
        def: true,
        rdp: 'networkautodetect',
        desc: '自动探测网络质量并据此调整体验。'
      },
      {
        key: 'bandwidthAutoDetect',
        label: '带宽自动检测',
        type: 'check',
        def: true,
        rdp: 'bandwidthautodetect',
        desc: '自动探测可用带宽并调整传输量。'
      },
      {
        key: 'compression',
        label: '批量压缩',
        type: 'check',
        def: true,
        rdp: 'compression',
        desc: '压缩传输的数据以减少带宽占用。'
      },
      {
        key: 'videoPlaybackMode',
        label: '多媒体流',
        type: 'check',
        def: true,
        rdp: 'videoplaybackmode',
        desc: '优化视频等多媒体内容的播放。'
      },
      {
        key: 'bitmapCachePersistEnable',
        label: '位图缓存持久化',
        type: 'check',
        def: true,
        rdp: 'bitmapcachepersistenable',
        desc: '把位图缓存留在磁盘上，下次连接复用。'
      },
      {
        key: 'allowFontSmoothing',
        label: '字体平滑',
        type: 'check',
        def: true,
        rdp: 'allow font smoothing',
        desc: '在远程桌面上启用 ClearType 字体平滑。'
      },
      {
        key: 'allowDesktopComposition',
        label: '桌面合成',
        type: 'check',
        def: true,
        rdp: 'allow desktop composition',
        desc: '允许远程桌面合成效果（透明、阴影等）。'
      },
      {
        key: 'disableWallpaper',
        label: '禁用壁纸',
        type: 'check',
        def: false,
        rdp: 'disable wallpaper',
        desc: '远程会话不显示壁纸，省带宽。'
      },
      {
        key: 'disableFullWindowDrag',
        label: '禁用全窗口拖动',
        type: 'check',
        def: false,
        rdp: 'disable full window drag',
        desc: '拖窗口时只显示轮廓而不是完整内容，省带宽。'
      },
      {
        key: 'disableMenuAnims',
        label: '禁用菜单动画',
        type: 'check',
        def: false,
        rdp: 'disable menu anims',
        desc: '关闭菜单淡入淡出等动画，省带宽。'
      },
      {
        key: 'disableThemes',
        label: '禁用主题',
        type: 'check',
        def: false,
        rdp: 'disable themes',
        desc: '远程会话不使用视觉主题，省带宽。'
      },
      {
        key: 'disableCursorSetting',
        label: '禁用光标设置',
        type: 'check',
        def: false,
        rdp: 'disable cursor setting',
        desc: '不应用远程桌面的鼠标指针方案。'
      }
    ]
  },
  {
    title: '安全与网关',
    fields: [
      {
        key: 'promptForCredentials',
        label: '强制弹出凭据框',
        type: 'check',
        def: false,
        rdp: 'prompt for credentials',
        desc: '连接时总弹 Windows 凭据框，即使已存密码。'
      },
      {
        key: 'gatewayHostname',
        label: '网关地址',
        type: 'text',
        def: '',
        rdp: 'gatewayhostname',
        desc: '经 RD 网关连接时填网关主机名；填了它下面三项才出现。'
      },
      {
        key: 'gatewayUsageMethod',
        label: '网关用法',
        type: 'select',
        def: 3,
        options: GATEWAY_USAGE,
        rdp: 'gatewayusagemethod',
        desc: '何时使用网关（gatewayusagemethod 取 0–4）。'
      },
      {
        key: 'gatewayCredentialsSource',
        label: '网关凭据来源',
        type: 'select',
        def: '',
        // 官方枚举 0–5 之外的空值态：留空 ⇒ 不写该键 ⇒ mstsc 用官方默认 0
        optional: true,
        emptyLabel: '留空（不写该键）',
        options: GATEWAY_CREDENTIALS,
        rdp: 'gatewaycredentialssource',
        desc: '网关认证方式（官方取值 0–5）；留空即不写该键。'
      },
      {
        key: 'promptCredentialOnce',
        label: '网关与主机共用凭据',
        type: 'check',
        def: true,
        rdp: 'promptcredentialonce',
        desc: '一套凭据同时过网关和主机认证，免重复输入。'
      },
      {
        key: 'negotiateSecurityLayer',
        label: '协商安全层',
        type: 'check',
        def: true,
        rdp: 'negotiate security layer',
        desc: '与服务器协商使用哪一层安全协议。'
      },
      {
        key: 'disableConnectionSharing',
        label: '不复用已断会话',
        type: 'check',
        def: false,
        rdp: 'disableconnectionsharing',
        desc: '不复用断线留下的会话，而是新建一个。'
      },
      {
        key: 'enableRdsAadAuth',
        label: 'Entra ID 认证',
        type: 'check',
        def: false,
        rdp: 'enablerdsaadauth',
        desc: '用 Microsoft Entra ID 登录；开启后账号/域/密码被忽略。'
      }
    ]
  },
  {
    title: 'RemoteApp',
    fields: [
      {
        key: 'alternateShell',
        label: '替代 shell',
        type: 'text',
        def: '',
        rdp: 'alternate shell',
        desc: '登录后启动的程序，代替默认的桌面 shell。'
      },
      {
        key: 'shellWorkingDirectory',
        label: '工作目录',
        type: 'text',
        def: '',
        rdp: 'shell working directory',
        desc: '上面那个替代 shell 的工作目录。'
      },
      {
        key: 'remoteApplicationMode',
        label: 'RemoteApp 模式',
        type: 'check',
        def: false,
        rdp: 'remoteapplicationmode',
        desc: '按 RemoteApp 发布单个程序；开启后下列各项才出现。'
      },
      {
        key: 'remoteApplicationProgram',
        label: '程序',
        type: 'text',
        def: '',
        rdp: 'remoteapplicationprogram',
        desc: '要发布的远程程序路径或别名。'
      },
      {
        key: 'remoteApplicationName',
        label: '名称',
        type: 'text',
        def: '',
        rdp: 'remoteapplicationname',
        desc: '程序在客户端显示的名字。'
      },
      {
        key: 'remoteApplicationCmdLine',
        label: '命令行',
        type: 'text',
        def: '',
        rdp: 'remoteapplicationcmdline',
        desc: '传给远程程序的命令行参数。'
      },
      {
        key: 'remoteApplicationFile',
        label: '文件',
        type: 'text',
        def: '',
        rdp: 'remoteapplicationfile',
        desc: '要由远程程序打开的文件。'
      },
      {
        key: 'remoteApplicationIcon',
        label: '图标',
        type: 'text',
        def: '',
        rdp: 'remoteapplicationicon',
        desc: '客户端为该程序显示的 .ico 图标路径。'
      },
      {
        key: 'remoteApplicationGuid',
        label: 'GUID',
        type: 'text',
        def: '',
        rdp: 'remoteapplicationguid',
        desc: '该 RemoteApp 的唯一标识，便于区分同名程序。'
      },
      {
        key: 'remoteApplicationExpandCmdLine',
        label: '展开命令行变量',
        type: 'check',
        def: true,
        rdp: 'remoteapplicationexpandcmdline',
        desc: '命令行里的环境变量在客户端展开后再发。'
      },
      {
        key: 'remoteApplicationExpandWorkingDir',
        label: '展开工作目录变量',
        type: 'check',
        def: true,
        rdp: 'remoteapplicationexpandworkingdir',
        desc: '工作目录里的环境变量在客户端展开。'
      },
      {
        key: 'loadBalanceInfo',
        label: '负载均衡 Cookie',
        type: 'text',
        def: '',
        rdp: 'loadbalanceinfo',
        desc: '交给负载均衡器把连接导向正确会话的 Cookie。'
      }
    ]
  }
]

/** 所有字段（常用 + 高级），用于取值/回填/校验 */
export const ALL_FIELDS = [...COMMON_GROUPS, ...ADVANCED_GROUPS].flatMap((g) => g.fields)

const FIELD_BY_KEY = new Map(ALL_FIELDS.map((f) => [f.key, f]))

/** 表单默认值（新建连接的初值，照 §3.6 的默认列） */
export function defaultForm() {
  const form = {}
  for (const field of ALL_FIELDS) {
    if (field.type === 'pair') {
      const [a, b] = field.keys
      form[a] = field.def[0]
      form[b] = field.def[1]
    } else if (field.secret) {
      form[field.key] = ''
    } else {
      form[field.key] = field.def
    }
  }
  return form
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 互斥/依赖可见性规则：key → 谓词（true = 显示）。
 *
 * 为什么要有这张表：RDP 有些项**互相冲突**，同时写进 `.rdp` 会出现"设了没用"甚至互相覆盖
 * （真机踩过两次：缺 `screen mode id` 时 mstsc 默认全屏；`use multimon:i:1` 会让 mstsc 忽略
 * 窗口模式而跨屏全屏）。与其让用户配出矛盾组合，不如**只在前提成立时显示**。
 *
 * 规则依据（微软 RDP 属性文档）：
 * - `use multimon` 只在全屏下生效 → 已由字段自身 `showIf` 处理（见 COMMON_GROUPS）
 * - `desktopwidth/height`、`smart sizing`、`dynamic resolution` 都是**窗口模式**语义（全屏下由客户端/多显决定）
 * - `selectedmonitors`、`maximizetocurrentdisplays` 属于多显示器语义 → 需全屏 + 多显
 * - `singlemoninwindowedmode` 描述的是"**退出全屏后**是否切回单显示器"⇒ 只在**窗口模式**下显示
 *   （它天然读起来像"窗口相关"，全屏时无从体现；隐藏它会让这个开关彻底没有入口）。
 *   ⚠️ 官方文档标注它需要 `use multimon:i:1`，而本扩展的 `use multimon` 只在全屏时可见/写出 ⇒
 *   想让它真正生效，需要用户在**全屏 + 多显示器**下配置，见 README「字段可见性与行为变更」。
 * - 网关三项只有在填了**网关地址**后才有意义
 * - RemoteApp 六项只有在 **RemoteApp 模式**打开后才有意义；且 RemoteApp 与**管理会话**互斥
 * - **Entra ID 认证**打开后用户名/域/密码会被忽略（文档明确）→ 隐藏这四项
 * - `promptcredentialonce` 是网关与主机共用凭据的开关，同属网关语义
 */
const VISIBILITY = {
  desktopWidth: (f) => !truthy(f.fullscreen),
  desktopHeight: (f) => !truthy(f.fullscreen),
  smartSizing: (f) => !truthy(f.fullscreen),
  dynamicResolution: (f) => !truthy(f.fullscreen),
  selectedMonitors: (f) => truthy(f.fullscreen) && truthy(f.multimon),
  maximizeToCurrentDisplays: (f) => truthy(f.fullscreen) && truthy(f.multimon),
  // key 必须与字段 key **逐字符一致**（`fields.js` 的 key = DB 列名 = .rdp field）：
  // 这里曾是 `singlemonInWindowedMode`（小写 m），与字段 `singleMonInWindowedMode` 不匹配 ⇒
  // 规则成了死代码，那个字段既没被隐藏、又把用户值提交进库。R-D2 修复时把它改成了**恒隐藏**，
  // 但那又让开关没了入口（用户可见的行为变更）；本次改为"窗口模式下显示"——
  // 与其它规则同一套 `truthy` 口径（`fullscreen` 可能是 0/1/'1'/true）。
  singleMonInWindowedMode: (f) => !truthy(f.fullscreen),
  gatewayUsageMethod: (f) => nonEmpty(f.gatewayHostname),
  gatewayCredentialsSource: (f) => nonEmpty(f.gatewayHostname),
  promptCredentialOnce: (f) => nonEmpty(f.gatewayHostname),
  remoteApplicationProgram: (f) => truthy(f.remoteApplicationMode),
  remoteApplicationName: (f) => truthy(f.remoteApplicationMode),
  remoteApplicationCmdLine: (f) => truthy(f.remoteApplicationMode),
  remoteApplicationFile: (f) => truthy(f.remoteApplicationMode),
  remoteApplicationIcon: (f) => truthy(f.remoteApplicationMode),
  remoteApplicationGuid: (f) => truthy(f.remoteApplicationMode),
  remoteApplicationExpandCmdLine: (f) => truthy(f.remoteApplicationMode),
  remoteApplicationExpandWorkingDir: (f) => truthy(f.remoteApplicationMode),
  // RemoteApp 与"管理会话"（/admin）互斥
  adminSession: (f) => !truthy(f.remoteApplicationMode),
  // Entra ID 认证会忽略显式凭据
  username: (f) => !truthy(f.enableRdsAadAuth),
  domain: (f) => !truthy(f.enableRdsAadAuth),
  password: (f) => !truthy(f.enableRdsAadAuth),
  remember: (f) => !truthy(f.enableRdsAadAuth)
}

/**
 * 字段的可见性规则（**求值时合并，不就地改字段对象**）。
 *
 * 为什么不再把规则写回 `field.showIf`：`ALL_FIELDS` 里的字段对象是**模块级单例**，
 * 就地挂载等于"全局可变状态"；而可见性本该由**当前表单**求值。改成求值合并后，
 * `VISIBILITY` 保持纯数据表，`fields.js` 仍是纯模块，也不会出现"某条规则泄漏到别的字段对象"。
 * 字段字面量自带的 `showIf`（如 `multimon`）优先，不被这张表覆盖。
 */
export function fieldVisibilityRule(field) {
  const keys = [field?.key, ...(Array.isArray(field?.keys) ? field.keys : [])]
  return keys.map((k) => VISIBILITY[k]).find(Boolean) ?? null
}

/** 字段在给定表单下是否可见（唯一入口：UI 显示与提交范围同源） */
export function isFieldVisible(field, form) {
  if (typeof field?.showIf === 'function') return !!field.showIf(form)
  const rule = fieldVisibilityRule(field)
  return typeof rule === 'function' ? !!rule(form) : true
}

/**
 * 当前表单下**可见字段的 key 集合**（成对字段拆成两个 key）。
 *
 * 用途有两条，必须同源：① 模态框据此过滤要渲染的字段；② `buildSavePayload` 据此决定
 * 哪些字段"屏幕上不存在"，从而不把它的历史值提交进库。
 */
export function visibleFieldKeys(form) {
  const keys = new Set()
  for (const field of ALL_FIELDS) {
    if (!isFieldVisible(field, form)) continue
    keys.add(field.key)
    if (Array.isArray(field.keys)) for (const key of field.keys) keys.add(key)
  }
  return keys
}

/** 数据库行 → 表单值（勾选框归一成布尔、数值归一成整数） */
export function rowToForm(row) {
  const form = defaultForm()
  if (!row || typeof row !== 'object') return form
  for (const field of ALL_FIELDS) {
    if (field.type === 'pair') {
      for (const key of field.keys) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
          form[key] = toInt(row[key], form[key])
        }
      }
      continue
    }
    const value = row[field.key]
    if (value === undefined || value === null) continue
    if (field.type === 'check') form[field.key] = value === true || value === 1 || value === '1'
    else if (field.type === 'password') form[field.key] = ''
    else if (field.type === 'number' || field.type === 'select')
      form[field.key] = toInt(value, form[field.key])
    else form[field.key] = String(value)
  }
  form.id = row.id
  return form
}

/**
 * 「编辑时用户清空了密码框」的判定（保存语义里"清空即删除已存密码"的**唯一**入口）。
 *
 * 三个条件同时成立才算"清空"：① 是编辑（有 `id`）；② 表单里的密码为空；③ **打开模态框时确实
 * 读到了已存密码**（`storedPassword` 非空，由界面向扩展要 `password` 得到，见 ConnectionModal.vue）。
 *
 * 为什么必须有 ③：`storedPassword` 为空串有两种情况——新建（本来就没有密码），以及**读取失败 /
 * 从未存过**。后一种界面并不知道后台是否真的存着密码，若把"空密码框"一律当成"清空"，就会在
 * "只改其它字段、没碰密码"的常见路径上**静默删掉密码**。所以拿不准就不删（宁可不删，不误删）。
 *
 * @param {Record<string, unknown>} form
 * @param {unknown} storedPassword 打开模态框时从 `api.secrets` 读到的原值（读不到 ⇒ `''`）
 */
function passwordCleared(form, storedPassword) {
  if (form?.id === undefined || form?.id === null || form?.id === '') return false
  if (String(form.password ?? '') !== '') return false
  return String(storedPassword ?? '') !== ''
}

/**
 * 表单值 → 提交给扩展的载荷（勾选框写 0/1；密码只在勾了「记住密码」且有值时提交）。
 *
 * **隐藏即不提交**（§3.3 修法 2）：`showIf` 不成立的字段在屏幕上根本不存在，它的值可能只是上一轮
 * 操作留下的历史值（例如"填了网关地址 → 选了网关用法 → 又清空网关地址"），提交它会让
 * **屏幕上看到的选项与入库的值不一致**——用户下次把前提填回来时会看到自己没选过的取值，
 * 这正是"新建/编辑时选项错乱"的数据来源。因此隐藏字段一律用 `defaultForm()` 的默认值回填。
 *
 * `name` / `host` / `port` / `username` 也在 `ALL_FIELDS` 里（无可见性规则），同样由本循环统一处理。
 *
 * @param {Record<string, unknown>} form
 * @param {{ storedPassword?: string }} [options] `storedPassword` = 打开编辑模态框时从宿主
 *   `api.secrets` 读到的原值（新建 / 读不到 ⇒ `''`；界面把它原样传进来，见 ConnectionModal.vue）。
 *   它**只**用于区分"没动密码"与"清空密码"：前者密码框里还留着回填的值 ⇒ 走 `set`；后者 ⇒ 发
 *   `clearPassword` 让扩展删掉 `conn:<id>`。
 */
export function buildSavePayload(form, options = {}) {
  const payload = {}
  const defaults = defaultForm()
  const visible = visibleFieldKeys(form)
  if (form.id !== undefined && form.id !== null && form.id !== '') payload.id = form.id
  for (const field of ALL_FIELDS) {
    if (field.secret) continue
    const shown = visible.has(field.key)
    if (field.type === 'pair') {
      for (const key of field.keys) {
        const index = field.keys.indexOf(key)
        payload[key] = toInt(shown ? form[key] : defaults[key], field.def[index])
      }
      continue
    }
    const value = shown ? form[field.key] : defaults[field.key]
    if (field.type === 'check') payload[field.key] = value ? 1 : 0
    else if (field.type === 'number' || field.type === 'select') {
      payload[field.key] = toInt(value, field.def)
    } else payload[field.key] = String(value ?? '').trim()
  }
  // 密码是 secret（不走上面的字段循环），所以"隐藏即不提交"必须在这里**单独**成立：
  // 开了 Entra ID 认证时密码框在屏幕上不存在（username/domain/password/remember 一起隐藏），
  // 若还把表单里的历史密码交给 secrets/cmdkey，就等于"用户看不到的项被提交"——与上面同一条原则冲突。
  const passwordText = String(form.password ?? '')
  if (visible.has('password') && form.remember && passwordText.length > 0)
    payload.password = passwordText
  // 「清空即删除已存密码」：编辑时被**回填过**（`options.storedPassword` 非空）、现在又被清空 ⇒ 用户
  // 是明确要删掉它。判定细节见 `passwordCleared`；只改其它字段不动密码时密码框里还是回填的原值，
  // 走上一条 `set` 分支，**不会**走到这里（这就是"不误删"的关键）。
  else if (
    visible.has('password') &&
    form.remember &&
    passwordCleared(form, options.storedPassword)
  )
    payload.clearPassword = 1
  return payload
}

/**
 * 校验（§3.9.2）：主机非空、端口 1–65535、连接名非空且列表内唯一（编辑时排除自己）。
 * @returns {Record<string, string>} 字段 → 错误文案；空对象表示通过
 */
export function validate(form, rows = []) {
  const errors = {}
  const name = String(form.name ?? '').trim()
  if (!name) errors.name = '连接名不能为空'
  else {
    const dup = rows.some(
      (row) =>
        String(row?.name ?? '').trim() === name && String(row?.id ?? '') !== String(form.id ?? '')
    )
    if (dup) errors.name = '连接名已存在，请换一个'
  }
  if (!String(form.host ?? '').trim()) errors.host = '主机不能为空'
  const port = Number.parseInt(String(form.port ?? '').trim(), 10)
  if (!Number.isFinite(port) || port < 1 || port > 65535) errors.port = '端口必须是 1–65535 的整数'
  return errors
}

/** 卡片标题：username@host:port（无用户名时退化为 host:port） */
export function titleOf(row) {
  const host = String(row?.host ?? '')
  const port = row?.port ?? 3389
  const user = String(row?.username ?? '')
  return `${user ? `${user}@` : ''}${host}:${port}`
}

/** 卡片副行：连接名 · 域（都可空） */
export function subtitleOf(row) {
  const parts = []
  const name = String(row?.name ?? '').trim()
  const domain = String(row?.domain ?? '').trim()
  if (name) parts.push(name)
  if (domain) parts.push(`域 ${domain}`)
  return parts.join(' · ')
}

export { FIELD_BY_KEY }
