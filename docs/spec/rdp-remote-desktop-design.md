# 设计文档：RDP 远程桌面扩展 + 宿主三处修复

| 项   | 值                                                                                     |
| ---- | -------------------------------------------------------------------------------------- |
| 状态 | 待确认（spec 已定稿；本文件过审后开工）                                                |
| 前置 | `tmp/spec/rdp-remote-desktop.md`（12 条验收、14+5 条需求）                             |
| 归档 | 宿主 ADR → `docs/adr/`；扩展 spec/adr → `extensions/rdp/docs/{spec,adr}/`；删除 `tmp/` |

---

## 1. 决策摘要（spec → 设计落点）

| spec                  | 落点                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| R-A1 升级保留 `data/` | §2.1：`oixCore.ts` 在 `rm(backup)` 前插一步 `rename(backup/data → target/data)`，失败只记日志                       |
| R-A2 拒绝包内 `data/` | §2.2：`installFromPackage` 条目校验新增 `forbidden-entry` 错误码                                                    |
| R-A3 JS 助手跑成 Node | §2.3：抽纯函数 `resolveStdioSpawn()` 返回 `{program,args,env}`，JS 程序带 `ELECTRON_RUN_AS_NODE=1`；`ipc.ts` 调用它 |
| R-A4/R-A5 文档与 ADR  | §2.4                                                                                                                |
| R-B1..B14 扩展        | §3（结构/入口/helper/UI/字段表/打包/测试）                                                                          |
| D1/D2 存储            | §3.4：`api.sqlite.open('rdp.db')` + `api.secrets`                                                                   |
| D4 打包禁含 data/     | §2.2（宿主拒绝）+ §3.7（`pack.mjs` 排除）                                                                           |
| D5 helper 路线        | §3.3（JSON-RPC over stdio，`framing: 'ndjson'`）                                                                    |

## 2. 宿主改动设计（obox 仓库）

### 2.1 覆盖安装保留 `data/`（R-A1）

现状顺序（`src/main/oixCore.ts:254-303`）：写 `.obox-meta.json` 进 stage → `rename(target→backup)` → `rename(stage→target)` → `rm(backup)`。改法（**只加一步，不动既有 ①②**）：

```
… rename(stage → target) 成功之后、rm(backup) 之前：
  const oldData = join(backup, 'data')
  const newData = join(target, 'data')
  if (replaced && await pathExists(oldData) && !(await pathExists(newData))) {
    try { await fs.rename(oldData, newData) }          // stage 与 target 同卷（都在 extensions/ 下），rename 原子
    catch (err) { console.warn('[oix] 保留旧 data 目录失败（不影响安装）：', err) }
  }
```

- **失败语义**：保留失败**不阻断**安装、不删新版本；旧数据仍在 backup 里，但随后仍会被 `rm(backup)` 删除（与今天行为一致，只是多了一条日志）。
- **回滚路径不受影响**：`rename(stage→target)` 失败时走的还是原分支（把 backup 改回 target），此时 data 从未被移动。
- **`data` 名称唯一来源**：抽一个常量 `EXT_DATA_DIR = 'data'`（`oixCore.ts` 内导出），供 R-A2 与测试共用，避免字面量散落。

### 2.2 拒绝含 `data/` 的包（R-A2 / D4）

在 `installFromPackage` 的条目校验段（读过 `zip.getEntries()` 之后、解压之前）：

```
if (entries.some((e) => e.entryName === EXT_DATA_DIR || e.entryName.startsWith(`${EXT_DATA_DIR}/`))) {
  throw new OixInstallError('forbidden-entry', '包内不得包含 data/ 目录：它是扩展运行时数据目录，升级时由宿主保留')
}
```

- 新错误码 `forbidden-entry` 加进 `OixInstallError` 的联合类型与文档（**仓库唯一的 oix 安装错误码清单在 `troubleshooting.md` 的错误码表**；`api-reference.md` 里的错误码表是 `api.ipc` 的通道错误码，不是一处）。
- **不落盘**：校验在 `fs.rm(stage)` 之前完成，`targetRoot` 下不产生残留（测试断言）。
- 与 §2.1 呼应：拒绝包内 `data/` 后，`newData` 恒不存在，§2.1 的 `!exists(newData)` 分支成为纯保险。

### 2.3 JS 助手以 Node 运行（R-A3 / D5）

- 抽出纯函数（放进 `src/main/ipcCore.ts`，与既有 `ipcCore` 同风格、可单测）：
  ```ts
  export function resolveStdioSpawn(input: { program: string; args?: string[] }): {
    program: string
    args: string[]
    env?: Record<string, string>
    isJs: boolean
  }
  ```
  `isJs = /\.(c?js|mjs)$/i.test(program)`；`isJs` 时 `program = process.execPath`、`args = [program, ...args]`、`env = { ELECTRON_RUN_AS_NODE: '1' }`。**`process.execPath` 由调用方注入**（保持纯函数可测，不在 Core 里读全局）。
- `src/main/ipc.ts:155-163` 改为调用该函数，并把 `env` 透传给 `openStdioTransport`（其 `env` 选项最终交给 `minimalEnv(options.env)`，`src/main/ipcTransport.ts:28-35,55,81-83`）。
- 单测断言：`.cjs`/`.mjs`/`.js` → `env.ELECTRON_RUN_AS_NODE === '1'`；`.exe` → 不注入 env、program 原样。

### 2.4 文档与 ADR（R-A4 / R-A5）

- `docs/extension-api/api-reference.md`：`api.ipc` 一节补"JS 助手以纯 Node 运行（`ELECTRON_RUN_AS_NODE=1`），可用 `node:*` 内置模块，cwd = 扩展源目录/data"；`api.sqlite` 一节补"库文件在 `<扩展>/data/`，**覆盖安装时宿主保留 `data/`**"。troubleshooting 追加：助手拿不到 stdin（若再现）、包内带 `data/` 被拒。
- `docs/extension-api/guides-user.md`：打包一节写明**必须排除 `data/`**（并说明原因），错误码清单加 `forbidden-entry`。
- `skills/obox-ext-init/scripts/create-user-extension.mjs`：生成的 `scripts/pack.mjs` 显式跳过 `data/`（防止脚手架用户踩坑）。
- `docs/adr/00xx-extension-data-durability-and-js-sidecar.md`：记录三条取舍（升级保留 data/、包内禁含 data/、JS 助手 Node 语义）与退场条件。

## 3. 扩展设计（`extensions/rdp/`）

### 3.1 文件布局与数据流

```
extensions/rdp/
  manifest.json          main: ./index.js；contributes.ipcChannels: [{id:'rdp.helper',transport:'stdio',program:'./helper.cjs',framing:'ndjson'}]
  index.js               纯 ESM 入口：注册 App 卡片 + onMessage 路由（list/save/delete/open）+ sqlite/secrets/ipc 调用
  helper.cjs             Node 助手：storeCredential / deleteCredential / launch / probe / selftest
  lib/rdpFile.mjs        纯函数：连接配置 → .rdp 文本（CRLF，名称:类型:值）
  lib/cmdkeyArgs.mjs     纯函数：配置 → cmdkey 参数数组（含端口两条目标串策略）
  lib/connection.mjs     纯函数：校验、序列化、卡片标题 username@IP:Port
  ui/index.html          Vite 构建产物入口（base:'./'、outDir:'ui'）
  src/**                 Vue 3 子应用源码：卡片列表 / 模态框表单 / 删除确认 / 空态（构建到 ui/，源码与产物**不同目录**，避免 emptyOutDir 删源码）
  vite.config.mjs        base:'./'、build.outDir:'ui'、emptyOutDir:true、inlineDynamicImports:true
  test/*.test.js         node --test（覆盖 lib/ 三个模块 + helper 的 selftest）
  scripts/pack.mjs       零依赖 zip（**排除 data/**）→ out/rdp-<version>.oix
  package.json           type:module；scripts: dev/build/test/pack/release
  README.md              安装、调试（--debug-extension）、已知限制
  icon.svg / icon.png
```

数据流（与 spec §1.3 一致）：

```
Vue 页面 ──postMessage(obox-extension)──▶ index.js（主窗口，api.app.onMessage）
      ──api.sqlite CRUD──▶ rdp.db（<扩展>/data/rdp.db）
      ──api.secrets──▶ 密码
      ──api.ipc 'rdp.helper'──▶ helper.cjs（Node）：写 <cwd>/rdp/<id>.rdp → cmdkey → cmd /c start "" mstsc.exe <rdp>
      ◀──reply──┘  →  host 回 postMessage(obox-extension-reply) → 页面刷新
```

### 3.2 入口 `index.js`

- `default export function rdp(api)`：`api.app.register({...})`（§3.5）+ 注册 `api.app.onMessage` 路由，返回 cleanup（dispose 各注册、断开 ipc 通道）。
- 消息协议（页面 → 扩展）：`{ method: 'list'|'save'|'remove'|'open', payload }`，统一返回 `{ ok, data|error }`。
  - `list` → `db.get_all()` → 按 `createdAt` 排序返回
  - `save` → 校验（`lib/connection.mjs`）→ 有 `id` 走 `db.update({id},patch)`，否则 `db.insert(row)`；`remember && password` 时 `api.secrets.set('conn:'+id, password)`
  - `remove` → 先 `helper.deleteCredential`，再 `api.secrets.delete('conn:'+id)`、`db.del(id)`
  - `open` → 取密码（若有）→ `helper.launch({ rdpText, fileName, credential })` → 返回 `{ pid: null, path, warnings }` 或错误（经 `cmd /c start` 孤儿派发，见 §3.3 与 `docs/adr/0003`）
- 数据库初始化：`const db = await api.sqlite.open('rdp.db')`（表名 `rdp`，首次 `insert` 自动建表）。
- 生命周期：`export function uninstall(ctx)` 内遍历 secrets 前缀 `conn:` 删除（宿主不清 secrets）。

### 3.3 `helper.cjs` 协议与实现

- 传输：宿主 spawn，`framing: 'ndjson'`（一行一个 JSON）。**必须是标准 JSON-RPC 2.0**：宿主 `ipcCore` 收发双向强制 `jsonrpc:"2.0"`，缺了立即 `protocol-error` 关通道（`src/main/ipcCore.ts:496`）。故请求 `{jsonrpc:"2.0", id, method, params}`，响应 `{jsonrpc:"2.0", id, result}` 或 `{jsonrpc:"2.0", id, error:{code,message}}`。（§3.3 早先写的简写形状是笔误，实现以本节为准，并有 `test/helper.test.js` 钉死"缺 `jsonrpc` 会被拒"。）
- `storeCredential {host, port, user, pass, domain}`：
  - 目标串：`TERMSRV/<host>`；当 `port !== 3389` 时**再写一条** `TERMSRV/<host>:<port>`（官方未确认，两条都写）；`domain` 存在时 `user` 传 `DOMAIN\user`。
  - 执行 `cmdkey /generic:<target> /user:<u> /pass:<p>`（`node:child_process.execFile`，逐条 await，带超时）。
- `deleteCredential {host, port}`：`cmdkey /delete:<target>`（同样两条都试，缺条目不算失败）。
- `launch {rdpText, fileName, credential}`：先按需 `storeCredential` → 解析 mstsc 绝对路径（`%SystemRoot%\System32\mstsc.exe`）+ 前置校验（存在 / 路径可安全派发）→ 写 `<cwd>/rdp/<fileName>.rdp`（UTF-8 + CRLF，目录不存在则建）→ `spawn('cmd.exe', ['/c','start','',mstsc,rdpPath], { windowsVerbatimArguments:false, detached:true, stdio:'ignore', windowsHide:true })` → 等 `cmd` 退出码 0 → 返回 `{ pid: null, path, warnings }`（**退出码 0 只证明命令已派发**，见 `docs/adr/0003` 与 README §14）。
- `probe`：返回 `{cwd, node: process.versions.node, electron: process.versions.electron, runAsNode: process.env.ELECTRON_RUN_AS_NODE}`（诊断用，UI 的"环境检查"按钮）。
- `--selftest`：不进协议循环，写一份样例 `.rdp` 到临时目录并回读断言内容，退出码 0/1。
- **`.rdp` 清理**：每次 `launch` 覆盖写同 id 文件；不做自动清理（文件很小，且便于用户排查）。

### 3.4 存储

- 连接表（`rdp.db` 的默认表 `rdp`）：`id`（自增主键，由宿主 insert 返回）、`name`、`host`、`port`、`username`、`domain`、`remember`、以及 §3.6 的全部 `.rdp` 字段（用扁平列名，与 UI 字段一一对应）、`createdAt`、`updatedAt`。
- 密码**不入库**：`api.secrets` 键 `conn:<id>`；`remember=false` 时不写、并在保存时 `secrets.delete`。
- 迁移：本次首版无历史数据；若将来加字段，在 `install(ctx)` 里用 `db.query('PRAGMA table_info(rdp)')` 比对后 `ALTER TABLE`（写进 README 的维护说明）。

### 3.5 App 卡片

`{ id:'rdp.main', name:'远程桌面', version, author:'chenzhi', description, icon:<内联 SVG>, multiOpen:false, width:1024, height:720 }`（`base = new URL('.', import.meta.url)`；`url: new URL('./ui/index.html', base).href`）。**本期不用 `iconUrl`**（它是可选项，卡片图标用内联 SVG 即可；也免去额外准备 PNG）。

### 3.6 `.rdp` 字段表（常用/高级与默认值）

图例：**UI** 列 `常`=常用展开、`高`=高级折叠、`—`=由其他字段推导或不进 UI。默认值来自官方文档；标 `[未确认]` 的不进 UI 或标注。

| `.rdp` 键                                                                                                                                                                                   | 含义                                              | UI              | 默认                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `full address:s:`                                                                                                                                                                           | `host` 或 `host:port`（由主机+端口拼）            | 常（主机/端口） | 端口 3389                                                         |
| `username:s:`                                                                                                                                                                               | 用户名                                            | 常              | 空                                                                |
| `domain:s:`                                                                                                                                                                                 | 域                                                | 常              | 空                                                                |
| `prompt for credentials:i:`                                                                                                                                                                 | 强制弹凭据框                                      | 高              | 0（有记住密码时 0）                                               |
| `authentication level:i:`                                                                                                                                                                   | 认证失败策略                                      | 常              | 2                                                                 |
| `enablecredsspsupport:i:`                                                                                                                                                                   | NLA                                               | 常              | 1                                                                 |
| `administrative session:i:`                                                                                                                                                                 | 管理会话                                          | 常              | 0                                                                 |
| `autoreconnection enabled:i:`                                                                                                                                                               | 断线重连                                          | 常              | 1                                                                 |
| `screen mode id:i:`                                                                                                                                                                         | 1 窗口 / 2 全屏                                   | 常（全屏开关）  | 1                                                                 |
| `use multimon:i:`                                                                                                                                                                           | 多显示器                                          | 常              | 0                                                                 |
| `desktopwidth:i:` / `desktopheight:i:`                                                                                                                                                      | 分辨率（非全屏时生效）                            | 常              | 1280×800                                                          |
| `smart sizing:i:`                                                                                                                                                                           | 内容随窗口缩放                                    | 常              | 1                                                                 |
| `dynamic resolution:i:`                                                                                                                                                                     | 窗口变化改分辨率                                  | 常              | 1                                                                 |
| `session bpp:i:`                                                                                                                                                                            | 色深                                              | 高              | 32                                                                |
| `selectedmonitors:s:`                                                                                                                                                                       | 指定显示器（`mstsc /l` 取 ID）                    | 高              | 空（全部）                                                        |
| `maximizetocurrentdisplays:i:`                                                                                                                                                              | 全屏时占满当前显示器                              | 高              | 0                                                                 |
| `singlemoninwindowedmode:i:`                                                                                                                                                                | 窗口模式单显                                      | 高              | 0                                                                 |
| `audiomode:i:`                                                                                                                                                                              | 0 本地/1 远程/2 无                                | 常              | 0                                                                 |
| `audiocapturemode:i:`                                                                                                                                                                       | 麦克风重定向                                      | 高              | 0                                                                 |
| `redirectclipboard:i:`                                                                                                                                                                      | 剪贴板                                            | 常              | 1                                                                 |
| `redirectprinters:i:`                                                                                                                                                                       | 打印机                                            | 高              | 0                                                                 |
| `redirectcomports:i:`                                                                                                                                                                       | COM 口                                            | 高              | 0                                                                 |
| `redirectsmartcards:i:`                                                                                                                                                                     | 智能卡                                            | 高              | 0                                                                 |
| `redirectlocation:i:`                                                                                                                                                                       | 位置                                              | 高              | 0                                                                 |
| `redirectwebauthn:i:`                                                                                                                                                                       | WebAuthn                                          | 高              | 0                                                                 |
| `drivestoredirect:s:`                                                                                                                                                                       | 驱动器（空 / `*` / `DynamicDrives` / `C:\;E:\;`） | 高              | 空                                                                |
| `usbdevicestoredirect:s:`                                                                                                                                                                   | USB 重定向                                        | 高              | 空                                                                |
| `devicestoredirect:s:`                                                                                                                                                                      | MTP/PTP 设备                                      | 高              | `*`                                                               |
| `camerastoredirect:s:`                                                                                                                                                                      | 摄像头                                            | 高              | 空                                                                |
| `keyboardhook:i:`                                                                                                                                                                           | Win 键归属 0/1/2/3                                | 常              | 2                                                                 |
| `networkautodetect:i:`                                                                                                                                                                      | 网络自动检测                                      | 高              | 1                                                                 |
| `bandwidthautodetect:i:`                                                                                                                                                                    | 带宽自动检测                                      | 高              | 1                                                                 |
| `compression:i:`                                                                                                                                                                            | 批量压缩                                          | 高              | 1                                                                 |
| `videoplaybackmode:i:`                                                                                                                                                                      | 多媒体流                                          | 高              | 1                                                                 |
| `bitmapcachepersistenable:i:`                                                                                                                                                               | 位图缓存持久化                                    | 高              | 1                                                                 |
| `disable wallpaper:i:` 等体验开关（`allow font smoothing` / `allow desktop composition` / `disable full window drag` / `disable menu anims` / `disable themes` / `disable cursor setting`） | 桌面效果                                          | 高              | 效果开（除 disable* 为 0）                                        |
| `gatewayhostname:s:`                                                                                                                                                                        | 网关地址                                          | 高              | 空                                                                |
| `gatewayusagemethod:i:`                                                                                                                                                                     | 0 不用/1 始终/2 检测/3 默认/4 本地绕过            | 高              | 3                                                                 |
| `gatewaycredentialssource:i:`                                                                                                                                                               | 网关凭据来源                                      | 高              | 下拉框 0–5（官方枚举，已确证）+「留空（不写该键）」（本扩展默认） |
| `promptcredentialonce:i:`                                                                                                                                                                   | 网关与主机共用凭据                                | 高              | 1                                                                 |
| `negotiate security layer:i:`                                                                                                                                                               | 协商安全层                                        | 高              | 1                                                                 |
| `disableconnectionsharing:i:`                                                                                                                                                               | 不复用已断会话                                    | 高              | 0                                                                 |
| `enablerdsaadauth:i:`                                                                                                                                                                       | Entra ID 认证                                     | 高              | 0                                                                 |
| `alternate shell:s:`                                                                                                                                                                        | 替代 shell                                        | 高              | 空                                                                |
| `shell working directory:s:`                                                                                                                                                                | 工作目录                                          | 高              | 空                                                                |
| `remoteapplicationmode:i:`                                                                                                                                                                  | RemoteApp 模式                                    | 高              | 0                                                                 |
| `remoteapplicationprogram:s:` / `remoteapplicationname:s:` / `remoteapplicationcmdline:s:` / `remoteapplicationfile:s:` / `remoteapplicationicon:s:` / `remoteapplicationguid:s:`           | RemoteApp 定义                                    | 高              | 空                                                                |
| `remoteapplicationexpandcmdline:i:` / `remoteapplicationexpandworkingdir:i:`                                                                                                                | 变量展开位置                                      | 高              | 1                                                                 |
| `loadbalanceinfo:s:`                                                                                                                                                                        | 负载均衡 Cookie                                   | 高              | 空                                                                |
| `password 51:b:`                                                                                                                                                                            | —                                                 | —               | **不写**（走 cmdkey，spec §1.2）                                  |
| `connection type:i:` / `desktopscalefactor:i:`                                                                                                                                              | —                                                 | —               | **不进 UI**（前者已过时、后者将弃用）                             |

生成规则（`lib/rdpFile.mjs`）：只输出**非默认值或用户显式设置**的键 + 必填键；行序按上表；`CRLF` 结尾；布尔型写 `0/1`；字符串里的 `\` 与换行做转义防护；文件头写注释不合法（`.rdp` 无注释语法），因此不加。

### 3.7 打包与构建

- `npm run build`：`vite build`（`base:'./'`、`build.outDir:'ui'`、`emptyOutDir:true`、`rollupOptions.output.inlineDynamicImports:true`），产物 `ui/index.html` + `ui/assets/*`。
- `npm run pack`：`scripts/pack.mjs` 把 **`manifest.json`、`index.js`、`helper.cjs`、`lib/**`、`ui/**`、`icon.*`** 打进 `out/rdp-<version>.oix`（`lib/**` 必须在包内——`index.js` 静态 `import './lib/…mjs'`；设计早先的清单漏了它）；**显式排除 `data/`、`out/`、`node_modules/`、`.git/`、`src/`**。
- `npm run release`：`npm test && npm run build && npm run pack`。

### 3.8 调试流程（写进 README）

1. `npm run build`（或 `npx vite build --watch`）；
2. 在 obox 仓库根：`npm run dev -- -- --debug-extension rdp@<扩展目录绝对路径>`；
3. 应用里点"远程桌面"卡片 → 子窗口即 `app://debug/rdp/ui/index.html`（调试目录优先，`extensionDirs.ts:29-39`）；
4. `api.ipc` 的 `program: './helper.cjs'` 在调试态解析到**调试目录**下的 helper（`ipc.ts:149-152`），cwd = `<调试目录>/data`。

## 3.9 界面设计（`ui/`）

**前置约束**：App 卡片子窗口用 `url: app://…/ui/index.html`，是**跨源静态页**，**拿不到宿主主题 token**（token 只注入 html/srcdoc 那一路，`src/renderer/src/AppWindow.vue:38-52`）→ 本页**自带一套 CSS 变量**（下表），视觉上对齐 obox 的暗色风格但不依赖宿主。

### 3.9.1 布局（默认 1024×720，可缩放）

```
┌───────────────────────────────────────────────────────────────┐
│ 远程桌面   ⟨3 个连接⟩                          [ ＋ 新建连接 ] │ ← header 56px，sticky
├───────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────┐  ┌─────────────────────────┐      │
│ │ chenzhi@10.0.0.8:3389   │  │ ops@win-srv:13389       │      │ ← 卡片网格 auto-fill 320px
│ │ 生产跳板机 · 域 CORP    │  │ 测试机                  │      │
│ │                         │  │                         │      │
│ │ [打开] [编辑] [删除]    │  │ [打开] [编辑] [删除]    │      │
│ └─────────────────────────┘  └─────────────────────────┘      │
└───────────────────────────────────────────────────────────────┘
```

> **底部状态栏已于 1.0.3 整体移除**（提示只写控制台，见 `docs/adr/0003` 与 README §14）；
> 卡片右上角的状态点与其"点开看错误原文"展开区也已一并移除。

- **header**：左「远程桌面」标题 + 连接数徽标；右侧主按钮「＋ 新建连接」（`#0e639c`）。sticky，滚动时保持可见（满足"右上角添加按钮"）。
- **内容区**：`display:grid; grid-template-columns: repeat(auto-fill, minmax(320px,1fr)); gap:16px; padding:20px; overflow:auto`。宽度 <720px 时单列。
- **卡片**：圆角 8px、`--card` 背景、1px `--border`；结构 = 标题行（`username@host:port`，等宽字体、单行省略 + `title` 悬浮全量）/ 副行（连接名 · 域，可空）/ 按钮行（右对齐）。~~卡片右上角一个状态点（默认灰；打开中蓝并脉冲；成功绿 2s 后回灰；失败红并保留，点它展开错误原文）~~ **1.0.3 起已整体移除**：打开的成功/失败只写控制台；重复点击改由父级的 1 秒时间窗静默去重（`src/dedup.js`），界面不加禁用态、不加文案。
- **空态**：居中 SVG 图标 + 「还没有远程连接」+ 副文案 + 「新建第一条连接」主按钮（与 header 按钮同动作）。
- ~~**底部状态栏**：一行文本记录**最近一次操作结果**（成功/失败原因原文，如 `cmdkey` 失败时提示"凭据未保存，连接时可能要求输入密码"）。可点击折叠，默认展开。~~ **1.0.3 起无底部状态栏**：操作结果与 `cmdkey` 告警只写控制台（`console.info`/`console.error`，前缀 `[rdp]`），**界面上不可见**，见 README §14 与 `docs/adr/0003`。

### 3.9.2 模态框：新建 / 编辑

```
┌─ 新建连接 ─────────────────────────────────────────── ✕ ─┐
│ 连接名*  [生产跳板机        ]   主机*  [10.0.0.8        ] │ ← 常用区：两列网格
│ 端口     [3389]                用户名 [chenzhi          ] │
│ 域       [CORP]                密码   [••••••••] [记住]  │
│ 显示     ☑ 全屏  ☐ 多显示器   分辨率 [1280]×[800]        │
│ 体验     ☑ 剪贴板  ☑ 智能缩放  ☑ 动态分辨率              │
│ 音频     [本地播放 ▾]     键盘钩子 [仅全屏交给远程 ▾]         │
│ 安全     [认证级别 ▾] ☑ NLA  ☐ 管理会话  ☑ 自动重连      │
│ ▸ 高级选项（显示/本地资源/体验/安全与网关/RemoteApp）    │ ← 默认折叠
├──────────────────────────────────────────────────────────┤
│                                    [ 取消 ] [ 保存 ]      │ ← 固定操作条
└──────────────────────────────────────────────────────────┘
```

- 面板：宽 640（窄屏 100%−32px）、`max-height:80vh`、内容区滚动、遮罩 `rgba(0,0,0,.5)`、圆角 10px；标题按模式显示「新建连接」/「编辑连接」。
- **常用区**按上表 §3.6 的 `常` 字段分组：连接（名/主机/端口/用户名/域/密码+记住）、显示（全屏/多屏/分辨率/智能缩放/动态分辨率）、本地（剪贴板/音频/键盘钩子）、安全（认证级别/NLA/管理会话/自动重连）。
- **高级选项**用自绘折叠面板（`▸/▾` + 四组小节 + RemoteApp），组内字段沿用 §3.6 的 `高` 行；**多选一的控件一律是下拉框**，取值说明写在选项文本里（`取值 — 短说明`），更细的一句放在该 `<option>` 的 `title`；`gatewaycredentialssource` 已确证官方取值 0–5，做成下拉框并多一个「留空（不写该键）」选项 ⇒ 运行时不可能再写出非数字；**「未官方确认」角标机制整体删除**（没有字段再用）。
- **校验**：主机非空、端口 1–65535、连接名非空且列表内唯一；错误在字段下方红字（`--danger`），字段边框转红；有错时「保存」禁用。
- **交互**：**关闭路径只有按钮**——点遮罩、按 `Esc` 都**不**关闭（只能点「✕」「取消」，或保存成功自动关闭）；`Enter` 提交；提交中按钮禁用并显示 spinner；保存成功即关闭并把新卡片插入列表顶部（乐观更新，失败则回滚**并把原因写控制台**；模态框内仍显示字段错误行）。
- **密码**：`type=password` + 眼睛切换；「记住密码」未勾选时**不写** `api.secrets`，并在保存时删除旧值。

### 3.9.3 删除确认

小模态框（宽 420）：标题「删除连接」，正文 `确定删除「chenzhi@10.0.0.8:3389」？` + 说明「同时清理本机为该主机保存的凭据，操作不可恢复」，按钮 `[取消] [删除]`（危险色实心）。确认后：先 `deleteCredential` → 再删库行 → 列表移除该卡 + **控制台日志**。

### 3.9.4 视觉规范（自带变量）

| 变量        | 值                                     | 用途             |
| ----------- | -------------------------------------- | ---------------- |
| `--bg`      | `#1e1e1e`                              | 窗口背景         |
| `--panel`   | `#252526`                              | 卡片/模态框      |
| `--panel-2` | `#2d2d30`                              | 输入框/表头      |
| `--border`  | `#3c3c3c`                              | 分隔与描边       |
| `--fg`      | `#cccccc` / `--fg-dim` `#9d9d9d`       | 主/次文本        |
| `--accent`  | `#0e639c`（hover `#1177bb`）           | 主按钮/焦点环    |
| `--danger`  | `#f14c4c`                              | 删除按钮/错误    |
| `--ok`      | `#3fb950`                              | 成功状态点       |
| `--radius`  | `8px`（模态框 10px）                   | 圆角             |
| `--mono`    | `Consolas, "Cascadia Mono", monospace` | `user@host:port` |

字号：正文 13px、标题 15px/600、卡片标题 14px（~~状态栏 12px~~ 状态栏已于 1.0.3 移除）。间距 4/8/12/16/20 五档。焦点环 `0 0 0 2px var(--accent)`。滚动条按暗色自绘（`::-webkit-scrollbar`）。

### 3.9.5 无障碍与键盘

Tab 顺序 = header → 卡片（打开/编辑/删除）；按钮有 `aria-label`（如「打开 chenzhi@10.0.0.8:3389」）；模态框 `role="dialog" aria-modal="true"`、打开时焦点落到第一个输入、关闭后焦点回到触发按钮；**关闭只走按钮**（R-D4：`Esc` 与遮罩点击都不关闭，见 §3.9.2）。~~状态栏与卡片状态点的 `role="status"` 播报~~ 已随 1.0.3 的移除一起消失（提示只在控制台，屏幕阅读器不会播报）。

### 3.9.6 主题跟随（非目标，留口）

宿主若将来把 token 注入 `app://` 页面，可把上表变量改为读宿主 token 并加 `prefers-color-scheme`/宿主主题事件跟随；本期不做，只在 README 注明。

## 4. 测试计划

| 层               | 内容                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 宿主单测（新增） | `resolveStdioSpawn`（JS→env/program 替换；非 JS→原样）；`oix-install.test.ts` 加"覆盖安装保留 data/""拒绝含 data/ 的包（无残留）"            |
| 宿主实测         | 复跑本次探针场景（v1 写入 → v2 覆盖 → 文件仍在）；含 `data/` 的包被拒；`.cjs` 助手经 `api.ipc` 往返成功                                      |
| 扩展单测         | `lib/rdpFile.mjs`（字段映射/CRLF/转义/只写非默认）、`lib/cmdkeyArgs.mjs`（目标串两条策略、域拼接）、`lib/connection.mjs`（校验/标题/序列化） |
| 扩展自测         | `node helper.cjs --selftest`（写样例 `.rdp` + 回读断言，不调 cmdkey/mstsc）                                                                  |
| 端到端           | spec §7 第 8 条（真机到"拉起 mstsc"）+ 第 9 条（覆盖安装后列表仍在）                                                                         |
| 审视             | 独立子代理对照 spec 与本文档 review（阶段七），问题逐条处置                                                                                  |

## 5. 执行顺序与文件所有权（并行切分）

| 步  | 执行者    | 独占文件                                                                                                                                 |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 我        | 宿主改动：`src/main/oixCore.ts`、`src/main/ipcCore.ts`、`src/main/ipc.ts`、`test/oix-install.test.ts`、新增 `test/ipc-spawn.test.ts`     |
| 2   | 子代理 H1 | 文档同步：`docs/extension-api/{api-reference,guides-user,troubleshooting}.md` + `skills/obox-ext-init/scripts/create-user-extension.mjs` |
| 3   | 子代理 E1 | 扩展骨架 + `lib/**` + `test/**` + `scripts/pack.mjs` + `package.json` + `manifest.json` + `helper.cjs`                                   |
| 4   | 子代理 E2 | `ui/**`（Vue 子应用：卡片列表/模态框/删除确认/空态）                                                                                     |
| 5   | 我        | 集成、ADR、`README.md`、验收与审视                                                                                                       |

顺序：1 与 2/3/4 可并行（文件不重叠）；3 必须先于 4（E2 依赖 E1 定下的消息协议与字段名）；集成与端到端由我做。

**PR 切分**：PR1 = 宿主修复（步 1+2，改 obox）；PR2 = 扩展（步 3+4，`extensions/` 被 gitignore，故产物**不进** obox 仓库，只作为本地交付物与独立仓库内容）；归档（spec/ADR）随 PR1 与扩展目录各自落地。

## 6. 验收执行清单

1. `npm run typecheck && npm run lint && npm test`（宿主，含新用例）
2. 探针复跑：覆盖安装后 `data/` 仍在
3. `.cjs` 助手经 `api.ipc` stdio 往返成功（E2E）
4. `cd extensions/rdp && npm test`；`node helper.cjs --selftest`；`node scripts/pack.mjs`；`validate-manifest.mjs` 0 error；zip 内无 `data/`
5. 真机：卡片 → 子窗口 → 新增/编辑/删除确认/打开（`cmdkey /list` 有 `TERMSRV/<目标>`、`mstsc.exe` 进程起来即杀）
6. 覆盖安装扩展后列表仍在
7. `npx prettier --check`（宿主 + 扩展）
8. 阶段七独立审视 + 问题逐条处置

## 7. 风格与约定

- 中文注释与文档；代码 `.prettierrc`（singleQuote / semi:false / printWidth:100 / trailingComma:none）。
- 纯逻辑抽到 `lib/*.mjs`（可 `node --test`），helper 只做 IO 与进程；宿主侧纯逻辑抽 `*Core.ts`。
- 不写未验证结论；未实机验证的（多屏/音频/全屏真实会话、非默认端口凭据目标串）在 README 明示。

## 8. 勘误（本文档之后各轮的落地与实现变更）

本文档是**首版设计**，以下各处已被后续轮次取代（**以代码 + 扩展 README + 扩展 ADR 为准**）：

| 本文档位置                                                             | 已不成立的说法                                             | 实际实现                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.9 前置约束、§3.9.4 变量表、§3.9.6「主题跟随（非目标）」             | "拿不到宿主主题 token ⇒ 本页自带一套 CSS 变量、不跟随主题" | 宿主自 2026-10 起对 `url` 型卡片推送 `obox-theme` ⇒ **跟随宿主主题 + 内置兜底**（`src/theme.js`，见 `docs/adr/0002`、README §10）；`styles.css` 零色彩字面量，只有 `--radius*` 自留布局变量 |
| §3.9.2 的"常用区两列网格"与 §4 的表单结构                              | 两列栅格                                                   | **单列纵向**，每项 = 标签/控件同行 + **一行**灰字说明 + 红字错误（R-D3）                                                                                                                    |
| §6.2 的"radio 每项右侧跟一句短说明 / select 下方显示当前选中取值"      | radio 控件 + 额外说明行                                    | **多选一一律 `select`**；取值说明写进选项文本（`取值 — 短说明`），更细一句放该 `<option>` 的 `title`（R-D4）                                                                                |
| §3.9.2 的"`Esc` 关闭、点遮罩关闭"、§3.9.5 的"`Esc` 与遮罩点击均可关闭" | 三种关闭路径                                               | **关闭只走按钮**（「✕」「取消」或保存成功）；`Esc`、遮罩点击都不关闭（R-D4）                                                                                                                |
| §3.6 表格 `authentication level:i:` 默认列                             | 2                                                          | 表格那列写的是**本扩展**默认（仍为 2）；**官方默认是 3** ⇒ `.rdp` 里总是显式写出 2（`rdpFile.mjs` 的 `rdpDefault: 3`，M2）                                                                  |
| §3.2 / §3.3 关于 `singlemoninwindowedmode` "组合不可达 ⇒ 隐藏"的规则   | 恒隐藏                                                     | **窗口模式（`fullscreen` 为假）时显示**，全屏时隐藏并按默认值回填（M3，见 README「字段可见性与行为变更」）                                                                                  |
| §3.6 生成规则里的"`\` 与换行做转义防护"                                | 反斜杠要转义                                               | 只**折叠换行**；反斜杠是字面量（`drivestoredrive:s:C:\;E:\;` 依赖它），README「勘误」段已有同款结论                                                                                         |
| §3.9.3 删除确认的交互                                                  | 同 §3.9.2                                                  | 同 R-D4：只走「取消」「删除」按钮                                                                                                                                                           |
| §3.2 / §3.3 的 `pid` 判据（`launch → {pid}`、`open` 要求 pid）         | "拿到 mstsc 的 pid 才算成功"                               | **已被 1.0.3 取代**：经 `cmd /c start` **孤儿派发**，mstsc 不是助手的子进程 ⇒ `launch` 返回 `{ pid: null, path, warnings }`，成功判据 = `cmd` 退出码 0（`docs/adr/0003`）                   |
| §3.9.1 / §3.9.5 的底部状态栏、§3.9.1 的卡片状态点                      | 40px 状态栏记最近一次结果（可折叠）+ 卡片右上角状态点      | **1.0.3 起整体移除**：操作结果与 `cmdkey` 告警**只写控制台**（`[rdp]` 前缀），卡片状态点与"点开看错误原文"也不留；重复点击改由 1 秒静默去重兜住（`docs/adr/0003`、README §14）              |
| §3.9.4 变量表里 `--ok` 的用途"成功状态点"                              | 卡片状态点的绿色                                           | 状态点已随上一条移除（该变量表本身早已被宿主 token 取代，见本表第一行）                                                                                                                     |
