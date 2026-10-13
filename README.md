# 远程桌面（obox 用户扩展）

在 obox 的「应用」里提供一个 RDP 连接管理器：卡片列表（标题 `username@IP:Port`，列表上方带搜索框）、新建 / 编辑 / 删除确认 / 打开。
打开时生成 `.rdp` 文件 → 用 `cmdkey` 预置 Windows 凭据（密码不用手输）→ 拉起 `mstsc.exe`。

- 形态：**用户扩展**（`.oix` 分发），只贡献一个 App 卡片，界面只中文
- 平台：**仅 Windows**（依赖 `mstsc.exe` / `cmdkey.exe`）
- 与 obox 宿主只有扩展 API 依赖关系；运行期**零第三方依赖**（除注入的 `api` 外只用 `node:*`）

## 1. 目录结构

```
manifest.json          清单：main + contributes.ipcChannels（rdp.helper / stdio / ndjson）
index.js               入口（纯 ESM）：App 卡片 + 6 个方法（list/save/remove/open/probe/password）+ uninstall 钩子
helper.cjs             Node 助手：storeCredential / deleteCredential / launch / probe / --selftest
lib/rdpFile.mjs        .rdp 文本生成（字段表 §3.6、CRLF、转义防护）
lib/cmdkeyArgs.mjs     cmdkey 参数拼装（TERMSRV 目标串策略）
lib/connection.mjs     连接校验 / 归一 / 序列化（卡片标题、库行）
src/**                 Vue 3 子应用源码（构建到 ui/，与源码分目录；src/theme.js = 主题接收桥 + 兜底 token；src/search.js = 卡片搜索匹配器，纯函数）
ui/**                  Vite 构建产物（`ui/index.html` + `ui/assets/*`）
test/*.test.js         node --test（lib 三个纯模块 + 入口消息契约 + helper 集成 + 主题桥 / token 门禁 / 兜底可读性 / 表单状态 / 组件源码门禁 / 说明文本 / 搜索匹配器）
scripts/pack.mjs       零依赖打包 → out/rdp-<version>.oix
```

## 2. 安装

1. **扩展管理器**：obox → 扩展管理器 → 「安装扩展」→ 选 `out/rdp-1.0.2.oix`；
2. **拖拽**：把 `.oix` 直接拖进扩展管理器视图。

安装成功后「应用」里出现**远程桌面**卡片（安装目录名是 `rdp_chenzhi`，即 `<name>_<author>`，所以不要硬编码 `app://extensions/rdp/`）。
升级 = **直接覆盖安装同名包**（热生效，无需重启）；`data/` 由宿主在覆盖安装时保留（见 §6）。
卸载请用「卸载」而不是「先卸载再装」——已激活扩展的卸载会要求重启。

## 3. 开发与调试

```bash
npm install                 # 只为界面构建（vue/vite）；后端测试与打包不需要它
npm test                    # node --test：lib 三模块 + 入口契约 + helper 集成
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
- 数据目录**仍然是** `userData/extensions/rdp/data`（不是调试目录）；
- helper 的 cwd 是 `<扩展>/data`，`.rdp` 落在 `<扩展>/data/rdp/<id>.rdp`。

## 4. 消息契约（界面 ↔ 入口）

子窗口是跨源静态页，页面里**没有 `api`**，一切走宿主消息桥：

```
页面 → 宿主  { source:'obox-app', action:'obox-extension', appId:'rdp.main', channel:'rdp',
               requestId, payload:{ method, payload } }
宿主 → 页面  { source:'obox-app', action:'obox-extension-reply', requestId,
               result:{ ok:true, data } | { ok:false, error } }
```

`result` 就是入口 handler 的返回值（宿主把它放进 reply 的 `data`）。六个方法：

| method     | payload                   | data                                                         |
| ---------- | ------------------------- | ------------------------------------------------------------ |
| `list`     | `{}`                      | 连接行数组（按 `createdAt` 升序，附 `title`/`address`）      |
| `save`     | 连接对象（编辑时含 `id`） | 保存后的行（含 `id`、时间戳）                                |
| `remove`   | `{ id }`                  | `{ id, warnings: string[] }`（凭据/密码清理失败进 warnings） |
| `open`     | `{ id }`                  | `{ pid, warnings: string[] }`（`pid` = 拉起的 `mstsc.exe`）  |
| `probe`    | `{}`                      | helper 的环境信息 `{ cwd, node, electron, runAsNode }`       |
| `password` | `{ id }`                  | `{ password }`——已存密码（读不到就是 `''`，**不报错**）      |

- 失败一律 `{ ok:false, error:'中文可读文案' }`（handler 不抛错，桥信封尽量简单）；
- `channel` 也可以是方法名本身（`channel:'list'`, `payload:{}`），入口两种写法都认；
- `open` 的 `warnings` 里会出现「凭据未保存，连接时可能要求输入密码」这类提示（`cmdkey` 失败**不阻断**打开）。界面当前只展示成功/失败，warnings 是留给界面后续展示的。

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
| `.rdp` 文件  | `<扩展>/data/rdp/<id>.rdp`（每次打开覆盖写，不自动清理，便于排查）      |
| Windows 凭据 | `cmdkey` 的 `TERMSRV/<目标>` 条目（删除连接时清理）                     |

- **升级保留**：宿主在覆盖安装时把旧的 `data/` 移入新目录，因此升级后连接列表仍在；`.oix` 里**不含** `data/`（打包脚本显式排除，宿主安装器也会拒绝含 `data/` 的包）。
- **表结构演进**：`api.sqlite` 的表列在**首次 insert** 时按值的 JS 类型创建；后续 insert 会自动 `ADD COLUMN` 补新列，但 `update` 不会。因此新增字段必须保证"先有一次带全字段的 insert"（本扩展每次 save 都提交全部列，正是为此）。
- **卸载**：`uninstall(ctx)` 会打开 `rdp.db` 读出全部连接 id，逐个删除 `conn:<id>`。
  `api.secrets` **没有列表接口**，所以"以库里的 id 列表为准"是唯一可靠做法——若库已不可读（例如被手动删除），secrets 无法枚举、会留下残留条目（已记日志）。
- 调试运行与安装运行**共用同一个数据目录**（调试扩展只是入口/静态资源换目录）。

## 7. 已知限制（未验证项）

- **仅 Windows**：`mstsc.exe` / `cmdkey.exe` 是硬依赖，其它平台无法打开连接；
- **非默认端口的凭据目标串未官方确认**：官方只说明 `TERMSRV/<主机>`。本扩展在端口 ≠ 3389 时**同时写** `TERMSRV/<主机>` 与 `TERMSRV/<主机>:<端口>`（删除时两条都试），实际哪条生效请用 `cmdkey /list` 核对；
- **未采用 `password 51:b:`**：那是 DPAPI 用户+本机绑定的密文 blob，不可分发，且本机没有取密文的正规接口。密码走 `cmdkey`（密码会出现在 `cmdkey` 的 argv 里，与手敲命令同级，属已知接受的风险）；
- **真实会话未验证**：验收止于"拉起 `mstsc.exe`"（进程起来即结束），多显示器 / 全屏 / 音频 / 网关 / RemoteApp 与会话内的真实效果**没有实机验证**；
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

**失败时的降级**：`cmdkey` 任何一步失败都**不阻断**打开——`open` 返回 `warnings`（例如
「凭据未保存，连接时可能要求输入密码」），`mstsc` 仍会启动，由 Windows 自己弹凭据框。

### 勘误（阶段七审视后修正的断言）

- **数据目录不是同一个**：调试态 `extId=rdp`、helper 的 cwd 是**调试目录**/data；安装态 `extId=rdp_chenzhi`（`<name>_<author>`），库在 `userData/extensions/rdp_chenzhi/data/`。本文档早前把两者混为一谈的表述以本段为准。**验收「覆盖安装后连接列表仍在」必须用安装态跑**（调试态不经过 `.oix` 安装流程）。
- **`warnings` 是会展示的**：界面把 `open`/`remove` 返回的 `warnings` 拼进状态栏，不是"留给后续"。
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
- **首帧兜底**在 `src/theme.js` 的 `FALLBACK_TOKENS`（25 个宿主 token 的 dark 默认值副本）：模块脚本一执行就**同步**写入，
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
  搜索框只在"确实有连接"时出现（一条都没有时仍是原来的空态）；计数徽标与状态栏**仍是总数**；
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
