# spec：RDP 远程桌面用户扩展 + 宿主三处前置修复

| 项       | 值                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | 待确认（确认后写设计文档）                                                                                                                              |
| 来源     | 本会话 M1–M8 问答 + 4 轮追加决策 + 3 个只读事实调查子代理                                                                                               |
| 交付物 A | **宿主修复**（obox 仓库内，需 PR + ADR）：安装器保留 `data/`、拒绝含 `data/` 的 `.oix`、IPC 的 JS 助手环境                                              |
| 交付物 B | **RDP 用户扩展**（独立项目 `extensions/rdp/`，`.oix` 分发）                                                                                             |
| 归档     | 完成后 `tmp/spec/` → `extensions/rdp/docs/spec/`，`tmp/adr/` → 宿主改动进 `docs/adr/`（仓库级）、扩展改动进 `extensions/rdp/docs/adr/`；删除整个 `tmp/` |

---

## 1. 背景与已核对的事实

### 1.1 需求原文

做一个 Windows 远程桌面扩展：App 卡片打开子窗口，里面是**卡片列表**，每张卡标题 `username@IP:Port`，卡上三个按钮——**打开**（按该连接信息发起远程连接）、**编辑**（改这条连接）、**删除**（弹对话框确认）；界面**右上角**一个"新建连接"按钮，点击弹模态框，保存后**立刻出现在列表**。连接信息要尽可能齐全。

### 1.2 RDP 侧（子代理调查：微软官方文档 + 本机二进制字符串 + 本机实测）

- 本机 `mstsc.exe` 10.0.26100.8875、`cmdkey.exe` 10.0.26100.1 均在；**无** Store 版 `msrdc`；OS 26200.9457。
- `.rdp` 是文本（`名称:类型:值`，CRLF），字段分五组：基本连接/认证、显示、本地资源重定向、体验/性能、网关/安全/RemoteApp。**逐字段表已备**（含取值/默认值/依据等级：官方 / 历史文档 / 本机二进制命中 / 未确认）。
- 密码：**选 `cmdkey`**（官方 CLI）；`password 51:b:` 是社区逆袭的 DPAPI 用户+本机绑定 blob，**不可分发**，且本机无接口取密文。目标串 `TERMSRV/<主机>`；非默认端口官方未说明（两条都写、以 `cmdkey /list` 核对）。
- `mstsc` 参数：`[<file.rdp>] [/v:] [/admin] [/f] [/w: /h:] [/multimon] [/span] [/public] [/restrictedAdmin] [/remoteGuard] [/prompt] [/l]`；`/console` 已废；`/v:` 与 `.rdp` 同时给时优先级**未官方定义** → 实现坚持**单一来源：只写 `.rdp`**。

### 1.3 宿主侧（每条都实测或读码核实）

| 事实                                                                                                                                                                                                                        | 证据                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.sqlite` **已有完整 CRUD + 创建**：`open(name)`（自动建目录/库）、`insert`（首次写入自动建表，含 id 即 upsert）、`update(where,patch)`、`get`/`get_all`/`get_by`、`del`/`del_by`/`clear`、`query`、`exec`               | `src/api/types.ts:18-41`、`src/main/sqlite.ts:58-283`、文档 `api-reference.md:371-391`                                                                                                                                                                                         |
| 库文件落点 = `userData/extensions/<扩展id>/data/<name>.db`，而 **`<扩展id>` 就是安装目录名** `<name>_<author>`                                                                                                              | `src/main/sqlite.ts:35-37`、`src/main/fs.ts:14`、`capabilities.ts:75-79`（返回目录名）、`api-reference.md:374`（例：`…/todo_chenzhi/data/todo.db`）                                                                                                                            |
| **覆盖安装会删掉整个旧目录（含 `data/`）**——已用真实 `installFromPackage` 实测                                                                                                                                              | 探针输出：`升级后 data 目录存在=false、rdp.db 存在=false、probe.txt 存在=false`；代码 `src/main/oixCore.ts:289-303`（`rename(target→backup)` → `rename(stage→target)` → `rm(backup)`）。仓库自己的注释也认为应当保留：`src/main/python.ts:104`「用户库目录（随扩展升级保留）」 |
| 扩展**拿不到任何绝对路径**：`api.fs`/`api.sqlite` 只收相对路径、拒绝绝对路径/盘符/`..`，无 API 返回扩展目录                                                                                                                 | `src/main/fs.ts:12-19`、`src/main/sqliteCore.ts:26-33`                                                                                                                                                                                                                         |
| `api.shell.openPath` 不校验路径但**必须绝对路径**；`openExternal` 另限 http/https                                                                                                                                           | `src/main/ext.ts:105-127`                                                                                                                                                                                                                                                      |
| `api.ipc` stdio：`program` 必须相对扩展目录；**`.js/.cjs/.mjs` 约定用宿主 Node 运行**                                                                                                                                       | `src/main/ipc.ts:155-163`、`src/main/ipcTransport.ts:41-48`、`src/shared/ipcDeclaration.ts:77-97`（声明只支持 `id/transport/program/args/framing`，**无 env**）                                                                                                                |
| **该约定实际是坏的（实测）**：宿主用 `process.execPath`（electron.exe）+ `minimalEnv`（不透传 `ELECTRON_RUN_AS_NODE`），子进程以 **Electron 应用模式**启动 → 脚本会执行，但 **stdin 未接**、永不退出 ⇒ stdio 协议不可能工作 | 实测 ①无 env：`BOOT node=24.21.0 electron=44.6.0`、`STDIN_READY isTTY=undefined`、无 REPLY、20s 不退出；②显式 `ELECTRON_RUN_AS_NODE=1`：`REPLY {"id":1,...,"sqlite":"yes"}`、`process.exit(0)` 干净退出。`minimalEnv` 见 `src/main/ipcTransport.ts:28-35`                      |
| `api.secrets` 只有 get/set/delete，**取不到原始密文**；**卸载不清理**（需扩展自己在 uninstall 钩子删）                                                                                                                      | `src/api/types.ts:443-448`、`src/main/secrets.ts:14-27`、`src/main/extensionCleanup.ts:23-30`                                                                                                                                                                                  |
| App 卡片：`icon/iconUrl/url/html/multiOpen/width/height`；消息桥 60s 超时；`api.app` **无编程打开**                                                                                                                         | `src/api/registration.ts:8-33`、`src/main/appWindow.ts:164-167`、`src/api/types.ts:153-163`                                                                                                                                                                                    |

## 2. 已确认决策

| #   | 决策                                                                                           | 来源     |
| --- | ---------------------------------------------------------------------------------------------- | -------- |
| M1  | **用户扩展**（独立仓库 + `.oix`），界面只能在 App 卡片子窗口                                   | Q1       |
| M2  | **只做 App 卡片**（不加状态栏/命令/快捷键/树视图）                                             | Q2       |
| M3  | 表单**常用 + 高级折叠**；界面**仅中文**                                                        | Q5       |
| M4  | 密码走 **`cmdkey` 预置 Windows 凭据**（helper 执行），密码本体存 `api.secrets`                 | Q3       |
| M5  | 无 Python 运行时，只有随包的 `helper.cjs`                                                      | M4 推导  |
| M6  | **仅 Windows**                                                                                 | 需求本身 |
| M7  | **需要改宿主**（3 处，见 R-A1..A3）——最初判断"不需要"，被 1.3 的两条实测推翻                   | 实测改判 |
| M8  | `name: rdp`、显示名"远程桌面"、`author: chenzhi`；验收**止于"拉起 mstsc"**，真实会话由用户确认 | Q4       |
| D1  | 连接数据存 **宿主 `api.sqlite`**（`open('rdp.db')` + CRUD），不引入 helper 自持数据库          | 追加决策 |
| D2  | 数据库目录**固定** `userData/extensions/<扩展id>/data/`，**不改位置**                          | 追加决策 |
| D3  | 修安装器：升级时**保留 `data/`**；schema 迁移由扩展自己在 `install(ctx)` 里做                  | 追加决策 |
| D4  | **打包 `.oix` 禁止含 `data/`**：扩展侧打包脚本排除 + 宿主安装器拒绝                            | 追加决策 |
| D5  | 修 `api.ipc` 的 JS 助手环境（`ELECTRON_RUN_AS_NODE=1`），让纯 JS helper 真的跑成 Node          | 追加决策 |

## 3. 目标

1. obox 侧：把 1.3 里两条**实测出来的缺陷**修掉（升级丢数据、JS 助手跑不成 Node），并加一道"包内不得含 `data/`"的闸门。
2. 扩展侧：一个可用的 RDP 连接管理器（列表 / 新建 / 编辑 / 删除确认 / 打开），连接信息尽量齐全，密码不用手输。

## 4. 非目标

- 不改扩展数据目录位置、不新增 `api.env.dataDir` 之类的路径 API（D2/D1）。
- 不做 helper 自持数据库（D1）。
- 不做内置扩展、不做状态栏/命令/树视图入口、不做英文界面。
- 不做 `password 51:b:`；不支持 `msrdc`/Windows App；不支持非 Windows。
- 不做连接分组/标签/搜索/导入导出（需求没提，要加先问）。

## 5. 需求

### A. 宿主修复（obox 仓库，交付物 A）

| #    | 需求                                                                                                                                                                                                                                                      | 验收                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R-A1 | `oixCore.ts` 覆盖安装时**保留 `data/`**：在 `rm(backup)` 之前把 `backup/data` 移到新目录的 `data`；移动失败不得让安装失败或丢新版本（记日志、保底不阻断）。                                                                                               | 新增测试：安装 v1 → 在 `data/` 写文件 → 覆盖安装 v2 → **`data/` 与文件仍在**、入口已更新为新版本；替换失败回滚路径不丢数据。          |
| R-A2 | `.oix` **不得包含 `data/**`**：安装校验阶段直接拒绝，报可读错误（如"包内不得含 data/ 目录（它是扩展运行时数据目录）"），不落盘。                                                                                                                          | 新增测试：含 `data/x.db` 的包 → 抛 `OixInstallError`，且 `targetRoot` 下无残留（暂存目录被清理）。                                    |
| R-A3 | `api.ipc` 的 **JS 助手以纯 Node 运行**：为 `.js/.cjs/.mjs` 程序的子进程环境加 `ELECTRON_RUN_AS_NODE=1`（`minimalEnv` 已支持 extra env）。                                                                                                                 | 新增测试或端到端断言：助手收到 stdin 请求并回包、`process.versions.electron` 存在但行为同 Node（stdin 可用）、能自行 `process.exit`。 |
| R-A4 | 文档同步（AGENTS.md 强制）：`api-reference.md`（ipc JS 助手语义、sqlite 数据目录与升级保留）、`guides-user.md`（打包必须排除 `data/`）、`troubleshooting.md`（新增两条坑）、`scripts/create-user-extension.mjs` 与生成的 `pack.mjs`（**排除 `data/`**）。 | 文档改完自检：新规则都写进了对应 reference。                                                                                          |
| R-A5 | ADR：仓库 `docs/adr/` 新增一条，记录"扩展数据目录在升级时保留 + 包内禁含 data/ + JS 助手以 Node 运行"的取舍与实现。                                                                                                                                       | 归档时移入。                                                                                                                          |

### B. RDP 扩展（交付物 B）

| #     | 需求                                                                                                                                                                                                                                                                                                                                                                     | 来源            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| R-B1  | App 卡片：`id: rdp.main`、名称"远程桌面"、`icon`（内联 SVG）、`iconUrl: app://extensions/<安装目录名>/icon.png`、`url: app://extensions/<安装目录名>/index.html`、`multiOpen:false`、约 1024×720。                                                                                                                                                                       | M2              |
| R-B2  | 子窗口：**卡片列表**，每卡标题 `username@IP:Port`；三个按钮：**打开 / 编辑 / 删除**。                                                                                                                                                                                                                                                                                    | 需求            |
| R-B3  | 列表为空时给引导态（一句话 + 指向右上角新增）。                                                                                                                                                                                                                                                                                                                          | 需求隐含        |
| R-B4  | 右上角"新建连接"→ **模态框**表单（常用 + 高级折叠）→ 保存后**立刻**出现在列表。                                                                                                                                                                                                                                                                                          | 需求            |
| R-B5  | 编辑：同一模态框回填 → 保存后就地更新。                                                                                                                                                                                                                                                                                                                                  | 需求            |
| R-B6  | 删除：**确认对话框**（显示 `username@IP:Port`）→ 删除记录 + 清理对应 `cmdkey` 凭据 + 列表即时移除。                                                                                                                                                                                                                                                                      | 需求            |
| R-B7  | 打开：生成 `.rdp` → 有密码则预置 `cmdkey` 凭据 → `spawn mstsc.exe <rdp>`（detached）；失败给可读错误。                                                                                                                                                                                                                                                                   | 需求 + M4       |
| R-B8  | 字段：**常用**（连接名、主机、端口默认 3389、用户名、域、密码、记住密码、全屏、多屏、分辨率、智能缩放、动态分辨率、剪贴板、音频、键盘钩子、自动重连、认证级别、NLA、管理会话）；**高级折叠**（体验/性能开关、驱动器/打印机/COM/智能卡/麦克风/USB 重定向、网关三项、RemoteApp 六项、会话 bpp、备用 shell、连接栏）。字段名与取值照 §1.2 官方表，**未确认的字段不进 UI**。 | 需求 + M3       |
| R-B9  | 存储：连接列表 → `api.sqlite.open('rdp.db')` 的 CRUD（D1/D2）；密码 → `api.secrets`（键 `conn:<id>`，仅"记住密码"为真时写入）。                                                                                                                                                                                                                                          | D1/D2           |
| R-B10 | `uninstall()` 钩子：删除本扩展写入的全部 `secrets`（宿主不清）；`data/` 由宿主卸载流程删除。                                                                                                                                                                                                                                                                             | 1.3 事实        |
| R-B11 | `helper.cjs`：JSON-RPC（单请求/单响应）方法 `storeCredential` / `deleteCredential` / `launch` / `probe`；自己写 `.rdp` 到 `cwd/rdp/<id>.rdp`（每次重写）、调 `cmdkey`、`spawn mstsc.exe` detached。                                                                                                                                                                      | M4 + D5         |
| R-B12 | 校验：主机非空、端口 1–65535、连接名非空且唯一；非法输入表单内联报错、不提交。                                                                                                                                                                                                                                                                                           | 需求隐含        |
| R-B13 | 打包：`scripts/pack.mjs`（零依赖 zip）产出 `out/rdp-<version>.oix`，**排除 `data/`**（D4），根目录含 `manifest.json` + 入口 + `helper.cjs` + `index.html` + 资源。                                                                                                                                                                                                       | M1 + D4         |
| R-B14 | 测试：`.rdp` 文本生成、`cmdkey` 参数拼装、配置校验/序列化、卡片标题拼装抽成纯模块，用 `node --test` 覆盖。                                                                                                                                                                                                                                                               | workflow 阶段六 |

## 6. 交付物

```
（A）obox 仓库
  src/main/oixCore.ts            保留 data/ + 拒绝包内 data/
  src/main/ipc.ts                JS 助手环境加 ELECTRON_RUN_AS_NODE
  test/oix-install.test.ts       升级保留 data/、拒绝包内 data/ 的用例
  test/ipc-*.test.ts             JS 助手环境断言（能单测则单测，否则端到端）
  docs/adr/00xx-*.md             本需求宿主侧 ADR
  skills/obox-ext-dev/references/{api-reference,guides-user,troubleshooting}.md
  skills/obox-ext-dev/scripts/create-user-extension.mjs（生成的 pack.mjs 排除 data/）

（B）扩展（本地 extensions/rdp/，独立仓库托管，.gitignore 已排除 /extensions/）
  manifest.json  index.js  helper.cjs  icon.svg  icon.png
  ui/{index.html,src/**}                 Vite + Vue 卡片列表与模态框
  lib/{rdpFile,cmdkeyArgs,connection}.mjs   纯逻辑
  test/*.test.js                         node --test
  scripts/pack.mjs                       zip（排除 data/）
  package.json  README.md
```

## 7. 验收标准（可执行）

**A 宿主侧**

1. `npm run typecheck && npm run lint && npm test` 全绿；新增用例覆盖 R-A1/R-A2，且**先证明会红**（临时回退实现即失败）。
2. 手工复跑本次的探针场景：安装 v1 → 写 `data/rdp.db` → 覆盖安装 v2 → **文件仍在**。
3. 含 `data/x` 的 `.oix` 安装被拒且不落盘（错误可读）。
4. E2E：一个 `.cjs` 助手经 `api.ipc` 收到请求并回包（证明 R-A3 生效）。

**B 扩展侧**

5. `cd extensions/rdp && npm test` 全绿。
6. `node scripts/pack.mjs` 产出 `.oix`；`validate-manifest.mjs` 校验 **0 error**；zip 内**无** `data/`。
7. `node helper.cjs --selftest` 通过（临时目录写出 `.rdp` 并回读校验，不真的调 mstsc/cmdkey）。
8. 真机到"拉起 mstsc 为止"（`npm run dev -- -- --debug-extension rdp@<绝对路径>`）：App 出现卡片 → 打开子窗口 → 新增连接 → 保存后立刻出现在列表；点"打开"→ `cmdkey /list` 出现 `TERMSRV/<目标>` 且 `mstsc.exe` 进程真的起来（随即结束该进程，不进真实会话）；编辑改端口后标题随之变化；删除弹确认、确认后列表移除且 `cmdkey /list` 对应条目被清。
9. **升级不丢**：把扩展 `version` 改到 1.0.1 覆盖安装后，连接列表仍在（这条同时验证 R-A1 的端到端效果）。
10. `npx prettier --check extensions/rdp` 干净。
11. 按 workflow 阶段七派独立子代理对照本 spec 与设计文档审视，问题逐条处置。
12. README 写明已知限制：非默认端口的凭据目标串未官方确认、`password 51:b:` 未采用、仅 Windows、真实会话未验证。

## 8. 风险与未决项

| 项                                                                        | 处置                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 保留 `data/` 与"原子替换 + 回滚"语义交互                                  | 设计文档给出顺序与失败分支（先 `rename(backup/data → target/data)`，失败只记日志、不阻断安装）；测试覆盖回滚路径    |
| 拒绝包内 `data/` 可能影响既有扩展包                                       | 现状无扩展包含 `data/`（本地 `todo`/`obox-updater` 的包由各自 `pack.mjs` 生成）；报错文案明确指引"打包时排除 data/" |
| `ELECTRON_RUN_AS_NODE` 加入最小环境后的副作用                             | 仅对 `.js/.cjs/.mjs` 程序添加；测试断言助手 `require('node:sqlite')` 可用、stdin 正常                               |
| 非默认端口的 `cmdkey` 目标串                                              | 同时写 `TERMSRV/<host>` 与 `TERMSRV/<host>:<port>`，以 `cmdkey /list` 核对；README 标未官方确认                     |
| 密码经 `cmdkey /pass:` 的 argv 暴露                                       | 已知接受（与手敲同级）；README 写明                                                                                 |
| 真实会话（多屏/全屏/音频）无法验收                                        | M8：止于"拉起 mstsc"；README 标注未验证                                                                             |
| 调试运行与安装运行的数据目录不同（调试扩展的 helper cwd 是调试目录/data） | `.rdp` 是每次重写的临时产物，不受影响；设计文档写明                                                                 |

---

## 9. 偏离记录（阶段七审视后确认）

| 项                                                                                                                                   | 处置                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-B1 的 `iconUrl`（子窗口任务栏图标）未实现，`icon.svg`/`icon.png` 不存在                                                            | **确认偏离**：设计 §3.5 已决定"本期不用 `iconUrl`，卡片图标用内联 SVG"（也免去准备 PNG）；本表据此把 R-B1 的该项视为已确认删减，其余字段（id/名称/icon/url/multiOpen/尺寸）均已实现                                                          |
| `probe` 方法有实现与文档、界面无入口                                                                                                 | 保留为**诊断接口**（`node helper.cjs --selftest` 与 README 都指向它）；设计 §3.3 提过"环境检查按钮"但 §3.9 未设计该按钮——若要，属于后续需求                                                                                                  |
| `gatewaycredentialssource` 未做数值范围校验（`i:` 键可写出非数字）                                                                   | **已消除**（2026-10-11 整改）：界面改为下拉框（官方枚举 0–5「已确证」+ 「留空（不写该键）」），运行时不可能再写出非数字；`lib/rdpFile.mjs` 仍按"空串即不写、否则照写"处理，门禁见 `test/fieldDocs.test.js` 与 `test/componentSource.test.js` |
| 界面用 `parseInt`、后端 `lib/connection.mjs` 用 `Number` 校验端口 → `3389abc` 界面判合法、后端拒，用户看到"保存失败"而非字段内联红字 | 低风险体验问题；记入后续待办（统一为同一校验规则）                                                                                                                                                                                           |
| `open` 失败文案带 `对端返回错误 -32603:` 前缀                                                                                        | 低风险措辞；记入后续待办（转译成人类可读文案）                                                                                                                                                                                               |
| 测试未覆盖：helper `launch` 的 spawn 失败分支、`uninstall` 单条 delete 失败、tab 等控制字符转义                                      | 记入后续待办；后两项已由 README §9 的实测结论与脱敏回归测试覆盖了主要风险                                                                                                                                                                    |
| 审查中"README 数据目录/警告展示/设计引用"三处不成立断言                                                                              | 已在扩展 `README.md` 的「勘误」段修正（调试态与安装态数据目录不同、`warnings` 确实会展示、`lib/**` 设计里已列入）                                                                                                                            |
