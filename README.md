# 远程桌面（obox 用户扩展）

在 obox 的「应用」里提供一个 RDP 连接管理器：卡片列表（标题 `username@IP:Port`，列表上方带搜索框）、新建 / 编辑 / 删除确认 / 打开。
打开时生成 `.rdp` 文件 → 用 `cmdkey` 预置 Windows 凭据（密码不用手输）→ 经 `cmd /c start` 以**孤儿进程**
拉起 `mstsc.exe`（**不在 obox 进程树内**，obox 退出/被杀都不影响它；见 §14）。

- 形态：**用户扩展**（`.oix` 分发），只贡献一个 App 卡片，界面只中文
- 平台：**仅 Windows**（依赖 `mstsc.exe` / `cmdkey.exe`）
- 与 obox 宿主只有扩展 API 依赖关系；运行期**零第三方依赖**（除注入的 `api` 外只用 `node:*`）
- **运行位置（obox 2.0.0 起）**：入口在 **Extension Host Process**（Electron `utilityProcess`，独立 Node 进程，
  **没有 DOM / `window` / `document` / `localStorage`**）里按 `file://` 动态 `import()` 执行；`api` 仍是
  `plugin(api)` 注入。因此入口只用 `api.sqlite` / `api.secrets` / `api.ipc` / `api.app` 与 `node:*`，
  界面全在子窗口静态页 `ui/index.html` 里。清单 `apiVersion` 仍是 **1**、`activationEvents` 用缺省 `*`
  （理由见 §15）。

## 1. 目录结构

```
manifest.json          清单：main + contributes.ipcChannels（rdp.helper / stdio / ndjson）
index.js               入口（纯 ESM）：App 卡片 + 6 个方法（list/save/remove/open/probe/password）+ uninstall 钩子
helper.cjs             Node 助手：storeCredential / deleteCredential / launch / probe / --selftest（**由宿主进程 spawn**）
lib/appUrl.mjs         App 卡片页面 URL 推导（宿主里入口是 file:// ⇒ 显式拼 app://extensions|debug/…，见 §15）
lib/rdpFile.mjs        .rdp 文本生成（字段表 §3.6、CRLF、转义防护）
lib/cmdkeyArgs.mjs     cmdkey 参数拼装（TERMSRV 目标串策略）
lib/mstscArgs.mjs      cmd 命令行构造（`/c start` 的参数数组 + 转义护栏 + mstsc 绝对路径解析）
lib/connection.mjs     连接校验 / 归一 / 序列化（卡片标题、库行）
src/**                 Vue 3 子应用源码（构建到 ui/，与源码分目录；src/theme.js = 主题接收桥 + 兜底 token；src/search.js = 卡片搜索匹配器；src/dedup.js = 「打开」的 1 秒静默去重；均为纯函数）
ui/**                  Vite 构建产物（`ui/index.html` + `ui/assets/*`）
test/*.test.js         node --test（lib 五个纯模块 + 入口消息契约 + helper 集成 + appUrl 页面 URL 门禁 + sidecar 专项门禁 + 主题桥 / token 门禁 / 兜底可读性 / 表单状态 / 组件源码门禁 / 说明文本 / 搜索匹配器 / 打开去重）
scripts/pack.mjs       零依赖打包 → out/rdp-<version>.oix
```

## 2. 安装

1. **扩展管理器**：obox → 扩展管理器 → 「安装扩展」→ 选 `out/rdp-1.0.4.oix`；
2. **拖拽**：把 `.oix` 直接拖进扩展管理器视图。

安装成功后「应用」里出现**远程桌面**卡片（安装目录名是 `rdp_chenzhi`，即 `<name>_<author>`，所以不要硬编码 `app://extensions/rdp/`）。
升级 = **直接覆盖安装同名包**（热生效，无需重启）；`data/` 由宿主在覆盖安装时保留（见 §6）。
卸载请用「卸载」而不是「先卸载再装」——已激活扩展的卸载会要求重启。

## 3. 开发与调试

```bash
npm install                 # 只为界面构建（vue/vite）；后端测试与打包不需要它
npm test                    # node --test：lib 五模块 + 入口契约 + helper 集成 + 页面 URL / sidecar 专项门禁
node helper.cjs --selftest   # 写样例 .rdp 到临时目录并回读断言（不调 cmdkey/mstsc）
npm run build               # vite build → ui/
npm run pack                # → out/rdp-<version>.oix（零依赖手写 stored zip）
npm run release             # test + build + pack
```

在 obox 仓库根用调试扩展跑（改代码后重载窗口生效）：

```bash
npm run dev -- -- --debug-extension rdp@C:\绝对\路径\extensions\rdp
```

- 调试态子窗口 URL 是 `app://debug/rdp/ui/index.html`（调试目录优先），`program: './helper.cjs'` 解析到**调试目录**下的 helper；
- 数据目录跟着**扩展源目录**走：调试态是 `<调试目录>/data`（如 `…\extensions\rdp\data`），安装态是
  `userData/extensions/rdp_chenzhi/data`（宿主 `extensionDataDirOf(extensionDir)` = `<扩展目录>/data`，
  `src/extension-host/apiFactory.ts`）。早前"调试运行与安装运行共用同一个数据目录"的说法**已作废**（见 §9 勘误）；
- helper 的 cwd 就是那个 data 目录（`<扩展目录>/data`，由**拉起它的一侧**给：2.0.0 起是宿主进程，
  以前是主进程，两边同值），`.rdp` 落在 `<扩展目录>/data/rdp/<id>.rdp`；
- `--debug-extension` 的 **id 要等于调试目录名**（`rdp@…\extensions\rdp`）：宿主模式下入口是 `file://` 加载的，
  页面 URL 只能靠"目录名 vs 安装目录名 `<name>_<author>`"来区分 `app://debug/` 与 `app://extensions/`（理由见 §15）。

## 4. 消息契约（界面 ↔ 入口）

子窗口是跨源静态页，页面里**没有 `api`**，一切走宿主消息桥：

```
页面 → 宿主  { source:'obox-app', action:'obox-extension', appId:'rdp.main', channel:'rdp',
               requestId, payload:{ method, payload } }
宿主 → 页面  { source:'obox-app', action:'obox-extension-reply', requestId,
               result:{ ok:true, data } | { ok:false, error } }
```

`result` 就是入口 handler 的返回值（宿主把它放进 reply 的 `data`）。六个方法：

| method     | payload                   | data                                                                              |
| ---------- | ------------------------- | --------------------------------------------------------------------------------- |
| `list`     | `{}`                      | 连接行数组（按 `createdAt` 升序，附 `title`/`address`）                           |
| `save`     | 连接对象（编辑时含 `id`） | 保存后的行（含 `id`、时间戳）                                                     |
| `remove`   | `{ id }`                  | `{ id, warnings: string[] }`（凭据/密码清理失败进 warnings）                      |
| `open`     | `{ id }`                  | `{ pid: null, path, warnings }`（经 `cmd /c start` 孤儿派发，拿不到 pid，见 §14） |
| `probe`    | `{}`                      | helper 的环境信息 `{ cwd, node, electron, runAsNode }`                            |
| `password` | `{ id }`                  | `{ password }`——已存密码（读不到就是 `''`，**不报错**）                           |

- 失败一律 `{ ok:false, error:'中文可读文案' }`（handler 不抛错，桥信封尽量简单）；
- `channel` 也可以是方法名本身（`channel:'list'`, `payload:{}`），入口两种写法都认；
- `open` 的 `warnings` 里会出现「凭据未保存，连接时可能要求输入密码」这类提示（`cmdkey` 失败**不阻断**打开）。界面**不展示**任何提示（状态栏已移除）；warnings 与成败原因只进控制台（见 §14）。

### 4.1 密码：编辑时回填、可查看、清空即删除

密码**不在库里**（数据模型没变：`rdp.db` 没有任何密码列），它只存在宿主 `api.secrets` 的 `conn:<id>`
（safeStorage 加密）里。界面因此**永远不从 `list` 拿密码**，而是编辑时单独要一次：

- **编辑时回填**：模态框打开后（`rowToForm` 铺完表单**之后**）调 `password` 把值填进密码框；**新建不调**。
  库行的密码列语义照旧——`rowToForm` 仍把密码置空（"新建/无 id"路径的语义，`test/formState.test.js` 钉着它）；
- **可查看**：密码框默认仍是掩码（`type="password"`），右侧眼睛按钮在 `password` / `text` 之间切换
  （`ConnectionField.vue` 的 `passwordVisible`）；回填后点它就能看明文；
- **清空即删除已存密码**：编辑时把密码框清空（且「记住密码」仍勾着）→ 保存时**删除** `conn:<id>`。
  这条**只认界面显式声明的意图**（`save` 载荷里的 `clearPassword: 1`），而界面只在
  "确实回填到了非空密码 + 现在该框为空 + 记住密码勾着"时才发它（`src/fields.js` 的 `passwordCleared`）：
  - 只改其它字段、不碰密码 ⇒ 密码框里还是回填的原值，照旧**重写**（不会走删除分支）；
  - 新建 / 从没存过密码 / **读取失败**（拿不准后台到底有没有）⇒ **不删**（宁可不删，绝不误删）；
  - 取消「记住密码」⇒ 与以前完全一致（删除 secret）；
- **不写日志**：`password` 方法与共用的 `readStoredPassword` 里没有任何 `console.*`，密码只经返回值进界面；
  卡片列表（`list`）根本不碰 `secrets`；`save` 的失败文案经 `secretErrorText` 把已知明文擦成 `***`
  再交给界面。守卫在 `test/passwordBackfill.test.js`（用可识别的密码串断言日志/`list`/`open` 回包里都不含它）；
- ⚠️ **残留口径（与"记住密码"同一条）**：删除的只是 `conn:<id>` 这条 secret，Windows 凭据管理器里
  由 `cmdkey` 写入的 `TERMSRV/<目标>` 条目**不会**同时被清掉——它要等下次成功写入覆盖、或删除连接时
  由 helper 清理。所以"清空了密码"在 `mstsc` 眼里未必立刻"没有密码"，要看 cmdkey 里有没有旧条目。

## 5. 字段名（界面 / 数据库 / `.rdp` 三方对照）

界面 `src/fields.js` 的表单键、`api.sqlite` 的扁平列名、`.rdp` 键一一对应（改一处必须改三处）：

| 列名（= 表单键）                                                                        | `.rdp` 键                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `name` / `host` / `port` / `remember`                                                   | （元信息；`host`+`port` → `full address:s:`）                                                                                               |
| `username` / `domain`                                                                   | `username:s:` / `domain:s:`                                                                                                                 |
| `promptForCredentials`                                                                  | `prompt for credentials:i:`                                                                                                                 |
| `authenticationLevel`                                                                   | `authentication level:i:`                                                                                                                   |
| `nla`                                                                                   | `enablecredsspsupport:i:`                                                                                                                   |
| `adminSession`                                                                          | `administrative session:i:`                                                                                                                 |
| `autoReconnect`                                                                         | `autoreconnection enabled:i:`                                                                                                               |
| `fullscreen`                                                                            | `screen mode id:i:`（真=2 / 假=1）                                                                                                          |
| `multimon`                                                                              | `use multimon:i:`                                                                                                                           |
| `desktopWidth` / `desktopHeight`                                                        | `desktopwidth:i:` / `desktopheight:i:`                                                                                                      |
| `smartSizing` / `dynamicResolution`                                                     | `smart sizing:i:` / `dynamic resolution:i:`                                                                                                 |
| `sessionBpp`                                                                            | `session bpp:i:`                                                                                                                            |
| `selectedMonitors`                                                                      | `selectedmonitors:s:`                                                                                                                       |
| `maximizeToCurrentDisplays` / `singleMonInWindowedMode`                                 | `maximizetocurrentdisplays:i:` / `singlemoninwindowedmode:i:`                                                                               |
| `audioMode` / `audioCaptureMode`                                                        | `audiomode:i:` / `audiocapturemode:i:`                                                                                                      |
| `clipboard`                                                                             | `redirectclipboard:i:`                                                                                                                      |
| `redirectPrinters` / `redirectComPorts` / `redirectSmartCards`                          | `redirectprinters:i:` / `redirectcomports:i:` / `redirectsmartcards:i:`                                                                     |
| `redirectLocation` / `redirectWebAuthn`                                                 | `redirectlocation:i:` / `redirectwebauthn:i:`                                                                                               |
| `driveStoreDirect` / `usbDeviceStoreDirect`                                             | `drivestoredirect:s:` / `usbdevicestoredirect:s:`                                                                                           |
| `deviceStoreDirect` / `cameraStoreDirect`                                               | `devicestoredirect:s:`（默认 `*`）/ `camerastoredirect:s:`                                                                                  |
| `keyboardHook`                                                                          | `keyboardhook:i:`                                                                                                                           |
| `networkAutoDetect` / `bandwidthAutoDetect`                                             | `networkautodetect:i:` / `bandwidthautodetect:i:`                                                                                           |
| `compression` / `videoPlaybackMode` / `bitmapCachePersistEnable`                        | `compression:i:` / `videoplaybackmode:i:` / `bitmapcachepersistenable:i:`                                                                   |
| `disableWallpaper` / `allowFontSmoothing` / `allowDesktopComposition`                   | `disable wallpaper:i:` / `allow font smoothing:i:` / `allow desktop composition:i:`                                                         |
| `disableFullWindowDrag` / `disableMenuAnims` / `disableThemes` / `disableCursorSetting` | `disable full window drag:i:` / `disable menu anims:i:` / `disable themes:i:` / `disable cursor setting:i:`                                 |
| `gatewayHostname` / `gatewayUsageMethod`                                                | `gatewayhostname:s:` / `gatewayusagemethod:i:`                                                                                              |
| `gatewayCredentialsSource`                                                              | `gatewaycredentialssource:i:`（**下拉框 0–5 + 「留空（不写该键）」**；留空即不写）                                                          |
| `promptCredentialOnce` / `negotiateSecurityLayer`                                       | `promptcredentialonce:i:` / `negotiate security layer:i:`                                                                                   |
| `disableConnectionSharing` / `enableRdsAadAuth`                                         | `disableconnectionsharing:i:` / `enablerdsaadauth:i:`                                                                                       |
| `alternateShell` / `shellWorkingDirectory`                                              | `alternate shell:s:` / `shell working directory:s:`                                                                                         |
| `remoteApplicationMode` 等 RemoteApp 六项 + 两项 expand                                 | `remoteapplicationmode:i:` / `remoteapplication{program,name,cmdline,file,icon,guid}:s:` / `remoteapplicationexpand{cmdline,workingdir}:i:` |
| `loadBalanceInfo`                                                                       | `loadbalanceinfo:s:`                                                                                                                        |
| `password`                                                                              | **不写进 `.rdp`，也不入库**（`api.secrets` 键 `conn:<id>`；编辑时经 `password` 方法回填到密码框，见 §4.1）                                  |

生成规则（`lib/rdpFile.mjs`）：行序照上表，**CRLF** 行尾，只写**非默认值 / 用户显式设置**的键 + 必填键 `full address:s:`；
布尔写 `0/1`；字符串值里的 `\r\n` 折叠成空格（`.rdp` 没有转义语法，反斜杠是字面量，例如 `drivestoredirect:s:C:\;E:\;` 原样保留）。

## 6. 数据存放与升级保留

| 数据         | 位置                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| 连接         | `userData/extensions/rdp_chenzhi/data/rdp.db`（表名默认 `rdp`，扁平列） |
| 密码         | `api.secrets`，键 `conn:<id>`（safeStorage 加密，**不入库**）           |
| `.rdp` 文件  | `<扩展源目录>/data/rdp/<id>.rdp`（= helper 的 cwd；每次打开覆盖写，不自动清理，便于排查） |
| Windows 凭据 | `cmdkey` 的 `TERMSRV/<目标>` 条目（删除连接时清理）                     |

- **升级保留**：宿主在覆盖安装时把旧的 `data/` 移入新目录，因此升级后连接列表仍在；`.oix` 里**不含** `data/`（打包脚本显式排除，宿主安装器也会拒绝含 `data/` 的包）。
- **表结构演进**：`api.sqlite` 的表列在**首次 insert** 时按值的 JS 类型创建；后续 insert 会自动 `ADD COLUMN` 补新列，但 `update` 不会。因此新增字段必须保证"先有一次带全字段的 insert"（本扩展每次 save 都提交全部列，正是为此）。
- **卸载**：`uninstall(ctx)` 会打开 `rdp.db` 读出全部连接 id，逐个删除 `conn:<id>`。
  `api.secrets` **没有列表接口**，所以"以库里的 id 列表为准"是唯一可靠做法——若库已不可读（例如被手动删除），secrets 无法枚举、会留下残留条目（已记日志）。
- **数据目录跟着扩展源目录**：安装态 `userData/extensions/rdp_chenzhi/data`，调试态 `<调试目录>/data`
  （宿主 `apiFactory.ts` 的 `extensionDataDirOf(ext.path)`；`api.sqlite` / `api.fs` / `api.ipc` 的 cwd 共用这一个值）。
  调试扩展只是入口/静态资源换目录，**数据不共享**——要验"覆盖安装后连接列表仍在"，必须用安装态跑（见 §9 勘误）。

## 7. 已知限制（未验证项）

- **仅 Windows**：`mstsc.exe` / `cmdkey.exe` 是硬依赖，其它平台无法打开连接；
- **非默认端口的凭据目标串未官方确认**：官方只说明 `TERMSRV/<主机>`。本扩展在端口 ≠ 3389 时**同时写** `TERMSRV/<主机>` 与 `TERMSRV/<主机>:<端口>`（删除时两条都试），实际哪条生效请用 `cmdkey /list` 核对；
- **未采用 `password 51:b:`**：那是 DPAPI 用户+本机绑定的密文 blob，不可分发，且本机没有取密文的正规接口。密码走 `cmdkey`（密码会出现在 `cmdkey` 的 argv 里，与手敲命令同级，属已知接受的风险）；
- **真实会话未验证**：验收止于"`cmd` 退出码 0 且 `mstsc.exe` 进程出现"（随即结束，不进入会话；命令**已派发**≠已连上，见 §14），多显示器 / 全屏 / 音频 / 网关 / RemoteApp 与会话内的真实效果**没有实机验证**；
- **超长路径（>260 字符）与 UNC 路径未验证**：真机只验证过 30 层深目录（`cmd` 905ms、exit 0 成功）；`\\?\` 前缀不支持 `.rdp` 语义，`mstsc` 对 UNC 的行为未验证；
- `gatewaycredentialssource:i:` 的官方取值**已确证为 0–5**（0 询问密码 NTLM / 1 智能卡 / 2 用当前登录用户凭据 / 3 提示输入凭据并用基本认证 / 4 稍后由用户选择 / 5 基于 Cookie 认证，见 §11 的来源表）；界面是**下拉框**（含「留空（不写该键）」），留空即不写该键；
- **`use multimon:i:` 的官方默认值两版文档不一致**（当前 _Supported RDP properties_ 写 `1`、旧版 _Supported Remote Desktop RDP file settings_ 写 `0`）：全屏关闭时本扩展**不写该键**，是否该显式写 `use multimon:i:0` **未真机验证**；
- IPv6 主机未验证（`full address:s:` 未做 `[::1]` 方括号处理，按主机名/IPv4 口径拼装）；
- 界面（`ui/`）**跟随宿主主题**（`app://` 静态页是跨源页面，token 由宿主经消息下发，见 §10）；拿不到推送时用内置兜底配色，不空白、不报错。

## 8. 实现说明（与设计文档的两处偏差，均已实测）

1. **helper 的协议是标准 JSON-RPC 2.0**，不是设计 §3.3 的简写形状。
   宿主 `src/main/ipcCore.ts` 对**收发双向**都强制 `jsonrpc:"2.0"`，缺了这个字段通道会立刻以
   `protocol-error 缺少 jsonrpc: "2.0"` 关闭（`test/helper.test.js` 里有一条用例专门钉死这一点）。
   因此：请求 `{"jsonrpc":"2.0","id":1,"method":"probe","params":{}}`，
   响应 `{"jsonrpc":"2.0","id":1,"result":…}` 或 `{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"…"}}`。
   （设计 §2 的 D5 一栏写的也是 "JSON-RPC over stdio"，§3.3 的简写应视为笔误。）
2. **`lib/**` 必须打进 `.oix`**：`index.js` 静态 `import './lib/…mjs'`，设计 §3.7 的打包清单漏了它。
   `scripts/pack.mjs` 的白名单是 manifest.json / index.js / helper.cjs / lib / ui / icon.* / LICENSE，
   并显式排除 `data/`、`out/`、`node_modules/`、`.git/`、`src/`。

`.rdp` 文件的落盘/拉起全在 helper 里（纯 IO 与进程），纯逻辑都在 `lib/*.mjs`，因此都能用 `node --test` 覆盖。

## 9. cmdkey 的两个真机坑（已修，改代码前先读）

1. **`/pass:` 的值含空格时 cmdkey 会失败**：它自己重新解析命令行，值被空格截断后报
   `This command requires either the /U switch and a username`（exit 1）。
   修法：含空白时**把值整体加双引号、内部双引号翻倍**（`lib/cmdkeyArgs.mjs` 的 `quoteForCmdkey`）。
   ⚠️ **不要**改用 URL 编码 / 反斜杠转义：那样命令会"成功"但把**错误密码**存进凭据管理器
   （实测 `/pass:pass%20word` 返回成功、存进去的是字面 `pass%20word`）——静默的错误密码比失败更糟。
   回归护栏见 `test/cmdkeyArgsQuoting.test.js`。
2. **Node `child_process.execFile` 在 Windows 会再转义一遍参数**（默认按标准命令行解析器加引号、
   把内部引号变成反斜杠转义），而 cmdkey 用的是它自己的土解析器 → 同一组参数在 PowerShell 里能成功、
   经 `execFile` 却失败。修法：`execFile('cmdkey', args, { windowsVerbatimArguments: true })`
   （`helper.cjs` 的 `runCmdkey`），即"参数已拼好、原样传"。

**实测结论（2026 年本机 Windows 11 26200 / mstsc 10.0.26100.8875）**：加引号后，`空格`、
`空格+双引号`、`空格+单引号`、`空格+双引号+单引号` 四种密码经 helper 走完整链路（预置 → `cmdkey /list`
命中 `TERMSRV/<主机>` 与用户名 → 删除后消失）**全部成功**；`launch` 能写出 `.rdp` 并真的拉起
`mstsc.exe`（验证时随即结束进程，不进入真实会话）。

**1.0.3 的启动方式实测（同一台机器，探针用 `notepad.exe` / `cmd /c echo` 替身）**：

- `cmd /c start "" <目标> "<路径>"`（`windowsVerbatimArguments` 缺省 = `false`）能把路径**原样**交给被启动的进程：
  空格、中文、`&`、`^`、`(`、`)`、`!`、`|`、`<`、`>`、**不配对的 `%`** 全部原样到达；
  **唯一例外是 `%VAR%`** 会被 cmd 展开（`%TEMP%` 变成真实临时目录）⇒ 本扩展**拒绝**含 `%VAR%` 的路径（见 §14）；
- `cmd` **立即退出**：`exit` 事件在 49/50/56/62/65ms 触发、退出码 **0**（30 层深路径最坏 905ms，仍 0）；
- **父进程确实变成已退出的 `cmd`**：`cmd` pid=15976 退出 62ms 后，被启动进程的 `ParentProcessId=15976`，
  而该 pid 已查不到（同一时刻 node 仍存活）；
- **失败的三种真实形态**：① `start` 一个**不存在的程序名** ⇒ `cmd` **不退出**（≥8s，会弹"选择打开方式"对话框）
  ⇒ 所以先 `existsSync(mstsc.exe)`；② `.rdp` 指向不存在的盘 ⇒ `cmd` **仍 exit 0**（mstsc 自己弹框）
  ⇒ 所以"已通过 shell 打开"不等于"已连上"；③ 非 `.rdp` 文件喂给 mstsc ⇒ `cmd` **仍 exit 0**。
  （真机到"真的 mstsc 且父进程已断链"的验收清单见扩展 spec §16.2，本扩展**未**在真机上跑完那几条。）

**失败时的降级**：`cmdkey` 任何一步失败都**不阻断**打开——`open` 返回 `warnings`（例如
「凭据未保存，连接时可能要求输入密码」），`mstsc` 仍会启动，由 Windows 自己弹凭据框。

### 勘误（阶段七审视后修正的断言）

- **数据目录不是同一个**：调试态 `extId=rdp`、helper 的 cwd 是**调试目录**/data；安装态 `extId=rdp_chenzhi`（`<name>_<author>`），库在 `userData/extensions/rdp_chenzhi/data/`。本文档早前把两者混为一谈的表述以本段为准。**验收「覆盖安装后连接列表仍在」必须用安装态跑**（调试态不经过 `.oix` 安装流程）。
- **`warnings` 只进控制台（1.0.3 起）**：状态栏已整体移除，`open`/`remove` 的 `warnings` 与操作结果一律
  `console.info`/`console.error`（前缀 `[rdp]`），**界面上不可见**——要看就开 DevTools 或看 obox 终端
  （见 §14「已知行为」）。
- **`lib/**` 在设计里已列入打包清单**（design §3.7 含 lib 并说明原因）；早前"设计漏了 lib"的说法不成立。
- **`.rdp` 文本处理**：只折叠换行（`.rdp` 无法表达多行值），**不转义反斜杠**——反斜杠是 Windows 路径/域名的正常字符，原样保留才正确；design §3.6 里"`\` 与换行做转义防护"的措辞按此理解。

## 10. 主题跟随（宿主 token）

子窗口是 `app://` 下的**独立文档且跨源**：CSS 自定义属性不跨文档继承，宿主也无法注入 `<style>`
（`iframe.contentDocument` 恒为 `null`）。因此主题 token **只能经消息送达**，本扩展为此装了一条接收桥
（`src/theme.js`，在 `src/main.js` 里于 `createApp().mount()` **之前**调用）：

```
宿主 → 子窗口  { source:'obox-app', action:'obox-theme', themeId, tokens }   # tokens: Record<token 名, 生效值>
子窗口 → 宿主  { source:'obox-app', action:'obox-theme-request' }            # 启动后 0 / 300 / 1000 ms 各一次
```

约定（改这里的任何一条都要同步宿主侧协议）：

- **token 来源 = 宿主推送**，扩展**不维护 token 值**；收到后逐条 `documentElement.style.setProperty(k, v)`；
- **首帧兜底**在 `src/theme.js` 的 `FALLBACK_TOKENS`（**只列本界面真的会消费**的宿主 token，1.0.3 移除状态栏后是 23 个）：模块脚本一执行就**同步**写入，
  因此"推送还没到"时界面也是可读的深色，不空白、不报错（3 次请求都没响应时打印一次 warn）；
  **这是明写的技术债**（宿主默认色的副本，会随宿主漂移，只在"拿不到推送"时可感知）——取舍与退场条件见 `docs/adr/0002-app-window-theme-bridge-and-fallback.md`；
- **仅兜底状态下的可读性**（N1）：输入类控件用到的每个 token 都必须有兜底值，且**输入框底色不得与其容器底色相同/同色**
  （宿主默认 token 里 `--bg-input` 与 `--border` 同值 `#3c3c3c`，高级区容器若也用 `--bg-input`，框就"消失"了——真机踩过）；
  实测对比度：正文/输入框底 ≈ 6.9:1、正文/窗口底 ≈ 10.4:1，placeholder（`--fg-dim`）≈ 2.2:1。守卫在 `test/fallbackInputs.test.js`；
- **`styles.css` 只写裸的自定义属性引用**（不写 `, fallback` 字面量——那又变成自造色值）：R-D1 要求该文件**零色彩/字体族字面量**，
  所以兜底值只能集中在上面那一处 JS 常量里；`test/stylesTokens.test.js` 钉住三件事：
  `styles.css` 零色值/零字体族/只用白名单 token、它消费的 token ⊆ `FALLBACK_TOKENS`、`FALLBACK_TOKENS` ⊆ 宿主 token 白名单（并与宿主 `main.css` 的 `:root` 逐条比对）；
- **`color-scheme`** 由 `colorSchemeForThemeId(themeId)` 决定（id 含 `light` → `light`，其余 → `dark`），只影响 UA 绘制的原生控件/滚动条底色；
- 非法键名 / 非字符串 / 空值的 token 一律**丢弃**并汇总 warn 一次；任何异常只 `console.warn('[rdp] …')`，**不抛错**；
  **有意的口径差**：宿主侧只判 `value === ''`，扩展侧更严（`value.trim() === ''`，纯空白也算空——否则 `var()` 会求值成空、文字/底色直接消失）；
- `src/bridge.js`（`obox-extension` 请求-响应桥）与主题推送**互不复用**：前者要经主进程 IPC、有 `requestId`，后者是宿主单向通知。
- **退场条件**：宿主能在**首帧之前**把 token 交给页面（协议层注入或 `srcdoc` 化），或扩展能声明并**强制校验**最低宿主版本 ——
  二者任一落地即可删掉 `FALLBACK_TOKENS`（届时只保留"拿不到就 warn"）。

## 11. 表单说明文本与控件形态（R-D3 / R-D4）

- **每项独占一行**：`.form-rows` 单列纵向（不再用两列栅格），`.field` 内是 `.field__row`（标签 + 控件同行）+ `.field__desc`（**一行**灰色说明）+ `.field__error`（校验红字）；
  成对字段（分辨率）仍是一个 `.field`，两个输入在 `.pair` 里并排；
- **说明文本**取自 `fields.js` 的 `field.desc`（65 个字段全覆盖），`field.hint` 优先于 `desc`（同一个字段只占一行灰字）；
  **一律单行短句**：字段说明 ≤ 48 字、取值短说明 ≤ 20 字、取值细说明 ≤ 30 字，超限即测试红（`test/fieldDocs.test.js`）；
- **多选一的控件一律是 `select` 下拉框**（`radio` 与其逐项说明行已删除），取值说明**写进选项文本**：`取值 — 短说明`（`options[].label`）；
  更细的一句放该 `<option>` 的 `title`（悬浮可见，不占界面行），**不再有**"选中取值"单独一行（`ConnectionField.vue`）；
- **覆盖率**：6 个带选项的字段、**26 个官方取值**（`audioMode` 3 / `keyboardHook` 4 / `authenticationLevel` 4 / `sessionBpp` 4 / `gatewayUsageMethod` 5 / `gatewayCredentialsSource` 6）全部有 `label` + `desc`；
  `gatewayCredentialsSource` 是 `optional` 字段：下拉框最前面多一个「留空（不写该键）」选项，它**不算官方取值**（不计入 26），由 `ConnectionField.vue` 渲染；
- **来源与纪律**：文本来自微软官方文档（_Supported RDP properties_ / _Supported Remote Desktop RDP file settings_）与仓内既有实测记录，
  **不编造语义**；原先 4 个字段 + `keyboardHook=3` 共 5 条「待确认」已按官方文档**逐条确证**，
  登记表（含来源 URL 与日期）在 `test/fieldDocs.test.js` 的 `OFFICIALLY_CONFIRMED`：覆盖率为"字段 65/65、取值 26/26、待确认 0"，
  该测试把"desc 非空"与"desc 已确证"**分开统计**（新增占位文本必须先改登记表，否则红）。

## 12. 字段可见性与默认值（行为变更记录）

### 12.1 `singleMonInWindowedMode`（窗口模式单显）的可见性（M3）

- 官方语义是"**多显示器**会话**退出全屏**时是否自动切回单显示器"（`0` 保留全部 / `1` 切回单个，默认 0），所以本扩展把它改成**窗口模式（`fullscreen` 为假）时显示**；
- **行为变更与旧值影响**：`R-D2` 修掉规则表里的 key 拼写错误（`singlemonInWindowedMode` → 小写 `m` 的死代码）后，它一度变成**恒隐藏**——界面上没有入口，但**库里已有的值仍在**（旧数据不会被清）；
  现在窗口模式下重新可见：**未全屏**的连接会把库里的值原样显示、并可修改后提交；**全屏**的连接该字段隐藏 ⇒ `buildSavePayload` 按默认值 `0` 回填（不会把隐藏时的历史值提交进库）；
- ⚠️ 官方文档标注该键需要 `use multimon:i:1`，而本扩展的「多显示器」只在全屏时可设 ⇒ **想让它真正生效，需要"全屏 + 多显示器"这套配置**（本扩展在窗口模式也允许填写，是"它描述的是退出全屏后的行为"的取舍）。此处的生效条件**未在真机验证**。

### 12.2 `authentication level` 的默认值（M2）

- **官方默认是 `3`（不要求身份验证），本扩展默认取 `2`（验证失败时警告）** —— 所以界面不再在 `2` 上标"（默认）"；
- `.rdp` 侧因此**总是显式写出** `authentication level:i:2`（`rdpFile.mjs` 的 `rdpDefault: 3`）。旧写法（比较值 = 本扩展默认 2）会把这个键省略，mstsc 于是用官方默认 `3` —— **界面说"警告"、实际一声不吭**，与 `screen mode id` 踩过的是同一类坑。

### 12.3 其余"本扩展默认 ≠ 官方默认"的布尔项（M2，逐条理由见 `lib/rdpFile.mjs` 的字段注释）

| `.rdp` 键                  | 官方默认 | 本扩展默认 | 理由                                                             |
| -------------------------- | -------- | ---------- | ---------------------------------------------------------------- |
| `smart sizing:i:`          | 0        | 1          | 窗口模式用桌面时，画面跟随窗口缩放是默认期望                     |
| `redirectclipboard:i:`     | 0        | 1          | 剪贴板互通是本管理器的主要用途（安全框仍要用户显式勾选，见 §13） |
| `redirectcomports:i:`      | 1        | 0          | 最小权限：不默认把本机串口暴露给远程                             |
| `redirectsmartcards:i:`    | 1        | 0          | 同上（智能卡）                                                   |
| `redirectwebauthn:i:`      | 1        | 0          | 同上（本机 Windows Hello / 安全密钥）                            |
| `remoteapplicationmode:i:` | 1        | 0          | 本扩展默认整桌面连接，RemoteApp 是少数场景                       |

- **布尔项一律显式写出**（`fieldValue` 的 bool 分支**不比较** `rdpDefault`）⇒ 上表差异都会**真的落进 `.rdp`**，不存在"省略该键 ⇒ 静默回落到官方默认"；
- 官方文档两版对 `use multimon` 的默认值说法不一（当前页 1 / 旧版表 0），因此全屏关闭时本扩展**只是不写该键**，不声称"等价于 0"；**是否该显式写 `use multimon:i:0` 未真机验证**（见 §7 未验证项）。

### 12.4 `gatewayCredentialsSource` 由自由文本改为下拉框（M4）

- 官方枚举 **0–5** 已确证（见 `test/fieldDocs.test.js` 的来源表），界面改成下拉框 ⇒ **运行时不可能再写出非数字**（旧版是自由文本，能写 `hello`）；
- 旧数据的兼容：库里若是旧文本值（例如 `hello`），下拉框会显示为空值选项（`rowToForm` 对无法解析的值回退默认 `''`）——**不会崩，也不会把它写进新的 `.rdp`**；用户在界面上重新选一次即可。

### 12.5 模态框关闭路径与输入框可读性（R-D4 / N1）

- **关闭只走按钮**：新建/编辑与删除确认两个模态框都**不再**响应 `Esc`、**不再**响应点遮罩（只留「✕」「取消」「保存/删除」按钮）；
- **高级区输入框可读性**：宿主默认 token 里 `--bg-input` 与 `--border` 同值（`#3c3c3c`），而高级区容器 `.accordion` 原本也用 `--bg-input` ⇒ 输入框的底色/描边/容器三者同色、框"消失"（用户实测："高级选项里文本框基本上看不清"）；现改为 面板 → 凹槽（`--bg`）→ 输入框（`--bg-input`）三层，`test/fallbackInputs.test.js` 钉住"输入框底色不得与其容器同色"与对比度下限。

### 12.6 密码回填与「清空即删除」（本次新增）

完整语义见 §4.1，这里是行为变更与取舍的记录：

- **新增一条扩展内部消息** `password`（`{ id }` → `{ password }`）：只读 `api.secrets` 的 `conn:<id>`，
  与 `open` 共用同一个 `readStoredPassword`（同键、同容错口径）；**取不到 / 读取异常一律空串且不报错**。
  数据模型**未变**（`rdp.db` 没有密码列、secrets 键名仍是 `conn:<id>`），`.rdp` 生成语义也**未变**；
- **行为变更 1（回填）**：以前编辑时密码框恒为空、要改密码就得重打一遍；现在打开编辑会填上已存密码（默认掩码，眼睛可看明文）。"留空"不再能用来表达"别动密码"——不动它时表单里就是原值，会原样重写；
- **行为变更 2（清空即删除）**：以前清空密码框**不会**删掉已存 secret（旧 secret 静默留着，下次打开照样用它连）；现在**清空并保存 = 删除** `conn:<id>`，界面上一行说明写在密码框的描述里。为避免"误删"，删除**只认界面显式声明的 `clearPassword`**（判定见 §4.1 与 `src/fields.js` 的 `passwordCleared`）：拿不准（读取失败 / 新建 / 从未存过）一律不删；
- 变更自证：`test/passwordBackfill.test.js`（14 条）与 `test/componentSource.test.js` 的 P1/P2 源码门禁；变异自证留档在 `docs/evidence/password-mutation-*.txt`。

### 12.7 卡片列表搜索（v1.0.1 引入搜索，v1.0.2 美化搜索框）

- **位置与交互**：卡片网格**上方**一个搜索输入框（占位文案「搜索名称 / 地址 / 用户名」），**输入即实时过滤**（`computed`，无防抖）；
  `Esc` 清空并**恢复全部**；**无匹配**时显示空态（复用既有空态组件，文案换成「没有匹配的连接」、不带主按钮）；
  搜索框只在"确实有连接"时出现（一条都没有时仍是原来的空态）；计数徽标**仍是总数**（状态栏已于 1.0.3 移除）；
- **形态（v1.0.2 起）**：胶囊形 + 内嵌放大镜（图标色走 `--fg-dim`、聚焦转 `--accent`）+ **宽度上限 400px**（窄窗自动收窄）；
  只用布局属性，仍是**零自造色值**、零字体族字面量（`test/stylesTokens.test.js` / `test/fallbackInputs.test.js` 继续绿）；
  v1.0.1 周期引入的搜索框先是 `width: 100%` 的扁平通栏版（1000px 窗口下像一行空表单），v1.0.2 只改形态、**匹配语义一行未动**；
- **搜哪些字段**（`src/search.js`，按 rdp 的**真实**库列）：`name` / `host` / `port` / `username` / `domain`，
  外加一项**派生**的卡片标题 `[username@]host:port`（与卡片显示共用 `fields.js` 的 `titleOf()`），
  目的是"照着卡片上看到的文字搜"也能命中（如 `chenzhi@10`）；`host` 为空的畸形条目不参与标题项；
- **匹配规则**（与另一个用户扩展 `extensions/webapp/src/search.js` **同一套语义 + 同一份 API 形状**）：
  **大小写不敏感**；对每个字段**分别打分取最优**再按词累加；**子序列匹配**（`chzi` 命中 `chenzhi`）；
  加权档位 **前缀 > 词首（分隔符 / 驼峰边界）> 连续片段 > 离散子序列**，并叠加"命中密度"（命中越集中分越高）；
  查询按空白拆词时**全词都要命中**（AND，各词可以落在同一行的不同字段上）；
- **排序**：按分数**降序**、**同分保持原序**（显式比较原索引）；**空查询 / 纯空白 → 返回全部且保持原序**
  （列表原有的"最新在前"顺序不变）；
- **不改数据**：纯前端过滤，不发扩展消息、不新增库列、不影响保存 / 打开 / 删除路径；
- 门禁：`test/search.test.js`（20 条）逐条钉住上面每一条；规格与取舍见 `docs/spec/rdp-search-box.md`
  （其中注明本次**取代** spec §4 非目标里的"不做搜索"一项，其余非目标不变）。

## 13. Windows 的「连接安全对话框」（2026-04 更新后必读）

用**打开 `.rdp` 文件**的方式发起连接时，Windows 会在建立连接前弹一个「远程桌面连接安全警告」框，列出这份文件**请求**访问的本地资源（剪贴板、打印机、智能卡、WebAuthn、驱动器、麦克风、相机、位置、COM/LPT 端口等）。

**重要：这个框里的复选框默认全部不勾**，必须由使用者**显式勾选**本次会话要用的资源——这与 `.rdp` 里写了什么无关。

依据（微软官方文档，2026-04-14 更新）：
<https://learn.microsoft.com/zh-cn/windows-server/remote/remote-desktop-services/remotepc/understanding-security-warnings>

> 每次打开 RDP 文件时，都会在建立任何连接之前显示安全对话框。它显示远程计算机地址，以及文件希望访问的每个本地资源对应的复选框。**默认情况下，对所有这些资源的访问处于关闭状态——必须显式启用每个资源。**

这是微软为 **CVE-2026-26151**（钓鱼 `.rdp` 静默共享本地资源）引入的加固，属于**预期行为**：

- 本扩展写出的 `redirectclipboard:i:1`（以及 `redirectprinters` / `redirectsmartcards` / `redirectwebauthn` 等）作用是**让该资源作为可选项出现在框里**，**不是**替用户勾上；
- 因此"我勾了剪贴板，但连接时那个框里没勾"**不是本扩展的缺陷**（我们知道这一点花了几轮实测：`.rdp` 里的键值与 Windows 自己保存的 `Default.rdp` 完全一致，本机也没有任何客户端重定向策略）；
- 微软 FAQ 另有说明：**"此更新仅影响通过打开 RDP 文件启动的连接。如果直接在'远程桌面连接'中键入计算机名称，体验将保持不变。"** —— 也就是说想完全避开这个框，只能改用命令行开关那种极简连接方式（会丢掉本扩展 60+ 项设置），本扩展**不采用**。

### 使用建议

1. 连接时在框里**只勾本次要用的资源**（要用剪贴板就勾「剪贴板」），其余保持不勾——这也是微软推荐的最小化原则；
2. 勾选**每次连接都要做**（该框对 `.rdp` 文件方式每次都会出现）；
3. 企业环境若确需回退旧行为，管理员可设 `HKLM\Software\Policies\Microsoft\Windows NT\Terminal Services\Client` → `RedirectionWarningDialogVersion`（DWORD）= `1`；官方标注"将来的 Windows 更新可能会删除对此设置的支持"，且属于安全降级，请自行评估。本扩展**不修改**该注册表。

## 14. 启动方式与已知行为（1.0.3 起：为什么用 cmd / 提示只在控制台）

完整取舍（被否决的 WMI / explorer 方案、退出码判据的代价、回退方案）见
[`docs/adr/0003-mstsc-orphan-launch-via-cmd.md`](docs/adr/0003-mstsc-orphan-launch-via-cmd.md)。这里只写使用者/维护者要知道的部分。

### 14.1 为什么绕一层 shell（孤儿进程）

`launch` 不再直接 `spawn('mstsc.exe', …)`，而是

```js
spawn('cmd.exe', ['/c', 'start', '', '%SystemRoot%\\System32\\mstsc.exe', '<.rdp 绝对路径>'])
```

`cmd` 在 ~60ms 内自己退出，于是 **`mstsc.exe` 的父进程是一条已经结束的 `cmd`**：

- **任务管理器 / Process Explorer 里看不到 `obox.exe → 助手 → mstsc.exe` 这条链**（mstsc 的 `ParentProcessId` 指向的进程已不存在）；
- **关掉 obox（正常退出或强杀）后，已经打开的远程桌面窗口仍在**——这是结构上的保证，不是"宿主恰好没做树杀"的侥幸
  （宿主结束 IPC 助手时只 `child.kill()` 直接子进程，`src/main/ipcTransport.ts:120-124`；宿主里唯一的 `/T` 树杀只服务 python 运行器）。

**验收方法**（pwsh）：

```powershell
# ① 父进程不是 obox / 助手：mstsc 的 ParentProcessId 查不到活进程，且不在 obox/助手的 pid 集合里
Get-CimInstance Win32_Process -Filter "Name='mstsc.exe'" | Select-Object ProcessId, ParentProcessId, CommandLine
Get-Process -Id <上面的 ParentProcessId> -ErrorAction SilentlyContinue   # 期望：查不到
# ② 关掉 obox 后 mstsc 仍在
(Get-Process mstsc -ErrorAction SilentlyContinue | Measure-Object).Count  # 关 obox 前后各看一次，期望不减
```

### 14.2 已知行为：**"已通过 shell 打开"不等于"已连上"**

成功判据是 **`cmd` 的退出码 0**，它只证明"命令已经派发出去了"。真机实测：把 `.rdp` 指向一个**不存在的盘**
（`Z:\definitely\missing\dir\x.rdp`）时 `cmd` **仍然 exit 0**，后续报错由 `mstsc` 自己弹框完成。
所以：

- 日志文案只写"**已通过 shell 打开 …**"，不写"已连接"；
- 打开前会先确认 `%SystemRoot%\System32\mstsc.exe` 存在（不存在 ⇒ 明确报错，不会静默）；
- 用户可控的字段（连接名/主机/端口/用户名…）只进 `.rdp` **文件内容**，**不进命令行**：命令行里只有
  `<SystemRoot>\System32\mstsc.exe` 与 `<扩展 data 目录>/rdp/<正整数 id>.rdp` 两个由扩展自己拼出的绝对路径。
  含 `%VAR%` 的路径会被**拒绝**（cmd 会把它展开成别的目录，属静默改写，比失败更糟）。

### 14.3 已知行为：**操作结果与告警只在控制台，界面上不显示**

1.0.3 起界面**没有底部状态栏**（与另一个用户扩展 `webapp` 同形态），卡片右上角的状态点与"点开看错误原文"
也一并移除，因此：

- 成功 / 失败 / **`cmdkey` 告警**（如「凭据可能未保存（TERMSRV/h）」「凭据未保存，连接时可能要求输入密码」）
  一律只写控制台，前缀 `[rdp]`，例如
  `[rdp] 已通过 shell 打开 chenzhi@10.0.0.8:3389`、`[rdp] 打开 … 失败：未找到 mstsc.exe（远程桌面客户端）：C:\Windows\System32\mstsc.exe`；
- **怎么看**：① 子窗口里按 `Ctrl+Shift+I` 开 DevTools 的控制台；② 或看 obox 终端——子窗口日志会经宿主转发，
  前缀 `[child-renderer:*]`，用 `[rdp]` 关键词 grep 最快；
- **代价（明写）**：不开 DevTools 时，正常路径下**看不到任何提示**（连"卡片变红"都没有了）；
  `role="status"` 的无障碍播报点也随状态栏消失（控制台日志不被屏幕阅读器播报）；
- 重复点击的挡板也换了：**同一卡片 1 秒内的重复点击直接忽略**（`src/dedup.js`），界面不出现任何变化
  （不加禁用态、不加文案）。窗口是固定 1 秒、**不跟随请求时长**：`open` 慢于 1 秒时第二次点击会被放行，
  仍可能开出两个窗口。

### 14.4 别把 `windowsVerbatimArguments` 改成 `true`

同一个仓库里两个**相反**取值，理由完全不同（见 §9 第 2 条）：

| 调用                       | 取值                | 为什么                                                                                        |
| -------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `cmdkey`（`runCmdkey`）    | `true`              | `cmdkey` 用它**自己的土解析器**，必须旁路 Node 的转义（参数由 `quoteForCmdkey` 拼好、原样传） |
| `cmd.exe`（`startViaCmd`） | `false`（**写死**） | `cmd.exe` 用**标准命令行解析器**，Node 的转义正是我们要的                                     |

改成 `true` 的后果：`.rdp` 路径含空格时 `start` 只拿到半截 token，而 `cmd` **仍然 exit 0** ⇒ **静默走错**，
且现有单测全绿（单测不启动真 `cmd`）。防线：代码里写死取值 + 注释、`lib/mstscArgs.mjs` 的纯函数矩阵、
以及 §14.1 的真机验收。

## 15. obox 2.0.0 宿主模式适配（D4 审计台账）

obox `2.0.0-rc.1` 起用户扩展在 **Extension Host Process** 里执行（`utilityProcess`、完整 Node、
**没有 DOM / `window` / `document` / `localStorage`**、入口按 `file://` 动态 `import()`），宿主
`apiVersion = 3`、清单支持 `activationEvents`（4 类，缺省 `*`）。本节记录本扩展逐条查证的结果，
**只改了一个真问题（§15.4 的页面 URL）**，其余"不改"都有理由。

### 15.1 入口不碰 DOM（✅ 无需改动）

`index.js` 与 `lib/*.mjs` 里没有 `window` / `document` / `localStorage`；能力全部走注入的 `api`
（`api.sqlite` / `api.secrets` / `api.ipc` / `api.app`）。DOM 只存在于子窗口静态页（`src/**` → `ui/**`），
那一侧本来就在浏览器上下文里。门禁：`test/extension.test.js` 的「宿主模式门禁」用例——
去掉注释后静态扫描 `index.js` + `lib/*.mjs`，出现 `window.` / `document.` / `localStorage` /
`sessionStorage` / `navigator.` 即红。

### 15.2 `api.ipc` sidecar 由宿主 spawn（✅ 无需改动，专项证据见 §15.6）

2.0.0 起 sidecar 的 `spawn` 发生在**宿主进程**（`src/extension-host/capabilities/ipc.ts` 的
`startStdioSidecar`），不再经主进程；`program` 的解析基准、cwd、env、分帧都由宿主按清单与
`api.ipc.connect` 的声明决定。本扩展对此**没有隐含假设**（不读进程 argv、不假设父进程是谁、
不依赖 cwd 找自己的文件），所以不需要改——只把"宿主那侧到底怎么算"钉成用例（§15.6）。

### 15.3 按字节分帧 / 多字节（✅ 不涉及，已补门禁）

本扩展的通道声明是 **`framing: "ndjson"`**（每行一条 JSON），**不是** `Content-Length`，因此没有
"按字符数算长度"这个坑：宿主的 `NdjsonParser` 在**字节**里找 `0x0a`（UTF-8 多字节序列中不会出现该字节），
再用 `payload.toString('utf8')` 解码（`src/main/ipcCore.ts`）；helper 侧用 `node:readline`
（`crlfDelay: Infinity`）读行、`process.stdout.write(JSON.stringify(msg) + '\n')` 写行——两侧都不自己算长度。
门禁：`test/helper.test.js` 的"多字节安全"用例（中文方法名进、中文错误文案出）与
`test/sidecarProgram.test.js`（断言 helper 里**没有** `Content-Length` 实现）。

### 15.4 页面 URL 不能是 `file://`（❗ 真问题，已修）

**现象**：入口原来是 `url: new URL('./ui/index.html', new URL('.', import.meta.url)).href`。
宿主模式下 `import.meta.url` 是 `file:///…/extensions/rdp_chenzhi/index.js` ⇒ 页面 URL 变成
`file:///…/ui/index.html`。主窗口 CSP 是 `default-src 'self' app:`（`src/renderer/index.html:10`），
`frame-src` 回落到 `default-src` ⇒ **iframe 被拦，卡片窗口一片空白**（且没有报错弹窗，只有控制台一条 CSP 违规）。

**改法**：新增 `lib/appUrl.mjs` 的 `appPageUrl(entryUrl, { name, author, page })`：
入口是 `app://`（渲染进程模式）⇒ 同源相对解析；入口是 `file://`（宿主模式）⇒ 用**目录名**拼
`app://extensions/<安装目录名>/…`，若目录名 ≠ 安装目录名 `<name>_<author>`（= 安装器的 `deriveDirName`）
则判为调试目录、拼 `app://debug/<目录名>/…`。`index.js` 的两个常量 `EXT_NAME` / `EXT_AUTHOR` 必须与
`manifest.json` 一致（`test/appUrl.test.js` 用真实清单比对，漂移即红）。

**已知限制（如实登记）**：`--debug-extension` 的 **id 必须等于调试目录名**（宿主只把 `path` 交给扩展，
没有协议告诉扩展"我是 `app://debug/<id>` 还是 `app://extensions/<安装目录名>`"）。用别的 id 调试时卡片会空白——
改 id 或改目录名对齐即可。

### 15.5 `apiVersion` 保持 1；`activationEvents` 保持缺省 `*`（✅ 都不改）

- **`apiVersion: 1` 不动**：`apiVersion` 是"最低宿主要求"，升 3 的语义是"我在没有 DOM 的宿主里才正确"。
  本扩展入口**本来就没用 DOM**，且 `api.ipc` / `api.sqlite` / `api.secrets` / `api.app` 在 v1 就有 ⇒
  升 3 只会**白白拒绝** obox 1.x（`apiVersion ≤ 2`）上的运行，换不来任何行为差别。旧宿主上它仍在渲染进程跑，
  页面 URL 由 `lib/appUrl.mjs` 的 `app:` 分支正确推导（两种模式都覆盖）。
- **`activationEvents` 继续缺省（= `*`，立即激活）**：本扩展**没有** `contributes.views` / `commands`，
  唯一的界面入口是 `api.app.register` 注册的 App 卡片，而卡片是在 `plugin(api)` 里注册的 ⇒ 改成
  `onView:` / `onCommand:` 会**永不激活、卡片永不出现**（`docs/extension-api/guides-user.md` §2 明写这条）。
  启动即激活的代价只有一次注册，sidecar **不随激活拉起**：`api.ipc.connect` 是懒的（`ensureHelper` 只在
  `remove` / `open` / `probe` 里调用），所以"启动多起一个 helper 进程"不会发生。

### 15.6 sidecar 专项（`contributes.ipcChannels` / program 解析 / cwd 变了会怎样）

清单的实际声明（`manifest.json`）：

```json
{
  "id": "rdp.helper",
  "transport": "stdio",
  "program": "./helper.cjs",
  "framing": "ndjson"
}
```

- **`program` 的解析方式**：宿主 `resolveProgramInExtension(extensionDir, program)` = `resolve(扩展目录, program)`
  并校验**不越出扩展目录**（`src/main/ipcTransport.ts:41-48`），`extensionDir` 来自 `init.extensions[].path`
  （安装态 `userData/extensions/rdp_chenzhi`，调试态是调试目录）。⇒ `./helper.cjs` 解析到
  `<扩展目录>/helper.cjs`，**与 cwd 无关**；`.js/.cjs/.mjs` 由宿主自带 Node 以 `ELECTRON_RUN_AS_NODE=1` 运行
  （`resolveStdioSpawn`）。本扩展是**相对路径、无盘符、无 `..`**，且解析结果真实存在
  （`test/sidecarProgram.test.js` 按宿主同一套规则断言）。
- **cwd 变了会不会坏**：不会。cwd 由**拉起方**给，两种模式**同值** = `<扩展源目录>/data`
  （宿主 `src/extension-host/capabilities/ipc.ts` 的 `cwd: dataDir`；主进程以前是
  `join(extensionDir, 'data')`）。helper 里所有模块加载都用 `__dirname` 的**绝对 URL**
  （`pathToFileURL(join(__dirname, 'lib', …))`），不依赖 cwd；唯一用到 cwd 的地方是**故意**的——
  `.rdp` 写到 `<cwd>/rdp/<id>.rdp`，即扩展 data 目录（升级保留、卸载随目录删除）。
  门禁：`test/sidecarProgram.test.js` 在**陌生 cwd** 下跑 `--selftest`、并用真实子进程握手
  断言 `probe.cwd` 就是宿主给的那个目录；`test/helper.test.js` 同样在临时 cwd 下跑一遍。
- **额外收益（宿主模式的差异）**：宿主 `startStdioSidecar` 给子进程的环境是
  `{ ...process.env, ELECTRON_RUN_AS_NODE: '1' }`（主进程模式是 7 项白名单 `minimalEnv`）。本扩展依赖的
  `PATH` / `SystemRoot` 两份里都有，`cmdkey` 与 `mstsc.exe` 的解析不受影响。

### 15.7 复跑门槛（本卡验收）

```bash
npm test                     # node --test（192 条，含 appUrl 页面 URL 门禁与 sidecar 专项）
npm run build                # vite build → ui/
npm run pack                 # → out/rdp-1.0.4.oix
node <obox>/scripts/validate-manifest.mjs manifest.json   # 0 error / 0 warning
```
