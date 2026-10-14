> **归档注记**：本文件是同一需求的 **阶段 2（实现规格，`to-spec`；权威版本 `rdp-mstsc-detach/spec@v2`）产物**，
> 由 obox 仓库 `.spec-workflow/rdp-mstsc-detach/spec.md` 于 2026-10-13 复制归档，属历史记录，正文按原文保留、不回改。
>
> 实现已随 **rdp v1.0.3** 发布；决策记录见 `docs/adr/0003-mstsc-orphan-launch-via-cmd.md`，方法契约以 `README.md` 与代码为准。
>
> 文中若出现 obox 仓库旧路径（`skills/obox-ext-dev/references/*`），已在 **obox v1.0.8** 迁到 `docs/extension-api/`。

# 实现规格：rdp 扩展——mstsc 以孤儿进程启动（脱离 obox 进程树）＋ 移除底部状态栏

- 规格 ID：`rdp-mstsc-detach/spec@v2`（**本文件为最新权威版本**；v1 → v2 的差异全部记在 §0）
- 阶段：SpecWorkflow 阶段 2（`to-spec`）**修订模式**｜日期：2026-10-13（v1）／2026-10-13（v2 修订）
- 权威需求结论：`.spec-workflow/rdp-mstsc-detach/requirements.md`（阶段 1，已关闭 Q1–Q3、风险 R-1–R-3、延后项 P1–P3）
- 目标仓库：`extensions/rdp/`（独立 git 仓库，remote `obox-org/rdp`，最近 tag `v1.0.2`）
- 请求语言：中文 ⇒ 本文件除代码标识符/路径/API 名外一律中文
- 产物落位：obox `.spec-workflow/rdp-mstsc-detach/`（未跟踪，不动 obox master）
- **修订状态：用户已逐条裁定 → v1 的"待决策"（现 §21）全部关闭；除 §21 D4 外无阻塞，可直接进入 `spec-do`**

---

## 0. 修订记录（v1 → v2，append-only）

| 项 | 内容 |
| --- | --- |
| Amendment ID | `rdp-mstsc-detach/spec@v2`（本节即修订记录；本目录尚无 `amendments/` 目录，按 skill「latest canonical artifact plus append-only amendment log」把记录内联在规格里） |
| 日期 | 2026-10-13 |
| 来源 | **用户在本会话的逐条裁定**（经主代理转达；子代理无法直接提问） |
| 读过的先前产物 | 本文件 v1；`.spec-workflow/rdp-mstsc-detach/requirements.md`；`extensions/rdp/{index.js,helper.cjs,manifest.json,package.json,src/**,test/**,README.md,docs/**}`；**先例** `extensions/webapp/{src/App.vue:90-106,src/theme.js:25-27,test/componentSource.test.js:110-125,140-152}`（"状态栏已移除"的既有做法） |
| 更新的权威产物 | **仅本文件** `.spec-workflow/rdp-mstsc-detach/spec.md`（**未**改 `requirements.md`——阶段 1 是历史记录，勘误写在 §26） |

### 0.1 决策关闭（用户按推荐采纳）

| 编号 | 裁定 | 写进规格的依据 |
| --- | --- | --- |
| **P1** | A：`windowsVerbatimArguments: false`（Node 转义）+ 纯函数只拦 `%VAR%`/引号/换行 | 本阶段真机矩阵 §5.3 P-1/P-2/P-3（11 类字符原样到达、仅 `%VAR%` 被展开） |
| **P2** | A：`.rdp` 文件**保留**（每次覆盖写、不自动清理） | 与现状 + 设计 §3.3（`design:133`）一致；§6.6 的产生顺序 |
| **D1** | A：`START_TIMEOUT_MS = 15_000` | 真机正常值 49–905ms（§5.3 P-4），余量 16× |
| **D2** | A：`launch` 保留 `{ pid: null, path, warnings }` | 与阶段 1 已关闭的 Q2 **逐字一致**，零契约破坏 |
| **D3** | A：纯函数测试 + `index.js` mock 契约 + `--selftest` 内嵌矩阵；**单测不真派发** | 与仓库既有 `lib/*.mjs` + `node --test` 模式一致；避免单测弹窗 |

### 0.2 用户改判（**行为范围变化**，本次修订的主体）

| 项 | v1 写的 | v2 改为 |
| --- | --- | --- |
| **P3** | 状态栏文案改成"已通过 shell 打开 …" | **整个底部状态栏删除**（与 `extensions/webapp` 保持一致）；**一切提示只写控制台**（`console.info` / `console.error`，前缀 `[rdp]`），**包括** `open` 的 `warnings`（如「凭据可能未保存（TERMSRV/h）」）与打开失败的错误 |

**连带范围**（本修订新增，逐项已在下方节次落地）：

| 文件 | 改动 |
| --- | --- |
| `src/App.vue` | 删 `import StatusBar`（`:14`）、三个 ref（`:38-40`）、`setStatus` 的 UI 写入（`:52-55`）、模板 `<StatusBar>`（`:377-382`）；**`setStatus` 保留**为"只写控制台"的诊断通道（先例 `webapp/src/App.vue:90-106`，注释里点明"用户要求界面不显示提示"） |
| `src/components/StatusBar.vue` | **删除文件**（74 行里 33 行） |
| `src/styles.css` | 删 `.statusbar` / `.statusbar--collapsed` / `.statusbar__toggle` / `.statusbar__text` / `.statusbar--ok .statusbar__text` / `.statusbar--error .statusbar__text`（`:411-457`）与焦点规则里的 `.statusbar__toggle:focus-visible`（`:284`）；`.app` 的 `height:100vh` flex 布局**不动**（footer 的 `flex: 0 0 40px` 消失后 `.app__content` 的 `flex: 1 1 auto` 自动长高 ⇒ 无布局回归） |
| `src/theme.js` | 兜底表删 `--statusbar-bg` / `--statusbar-fg`（`:41-42`）——兜底表**只放界面真会消费的 token**，先例 `webapp/src/theme.js:25-27` |
| `test/stylesTokens.test.js` | 改掉"兜底表必须与宿主 25 个 token 逐条相等"这条（`:126-127`），并新增"状态栏 token 不得残留"（§17.3）；**宿主白名单 `HOST_THEME_TOKEN_NAMES`（`:22-48`）保持 25 项不动** |
| `test/componentSource.test.js` | 新增"状态栏已移除"门禁（照 webapp `:110-125` 六条断言 + 兜底 token 残留两条，§17.1） |
| `test/passwordBackfill.test.js:188`、`test/helperSanitize.test.js:6`、`index.js:57` | 注释里"进界面状态栏"的措辞改为"进控制台/日志"（**只改注释，断言不动**） |
| 文档 | `README.md:210`、`:312`；`docs/spec/rdp-remote-desktop-design.md:235,243,266,271,288,292`；`docs/spec/rdp-search-box.md:29,96`（§18 表逐行） |
| 发布 | `npm run build` **必须重跑**（`ui/**` 内联的是旧文案与旧组件），再 `npm run pack` 出 `rdp-1.0.3.oix`（§22 步 6、步 9） |

### 0.3 如实登记的偏离（用户已知情接受）

| 编号 | 偏离 | 补偿手段 |
| --- | --- | --- |
| **D-1** | **告警在界面上不再可见**：`open` 的 `warnings`（「凭据可能未保存，连接时可能要求输入密码」等）由"状态栏可见"变为"只在控制台" | ① 控制台（子窗口日志经宿主转发到终端，前缀 `[child-renderer:*]`）；② README 新增 §14「已知行为」＋「为什么用 cmd」；③ 每条日志带 `[rdp]` 前缀与动作名，便于 grep；④ `warnings` 仍**原样在 `open` 回包里**（测试与排查都还能拿到） |
| **D-2** | 原有"**看状态栏**"的验收判据全部失效（设计文档 §3.9.1 的底部状态栏、§6 验收清单里的"状态栏提示"条目、`README.md:210`「warnings 是会展示的」） | 原文验收改为"**看控制台 / 开 DevTools**"：§16.2 新增 ⑤ 与逐条日志行判据；§18 表逐行给出文档改法 |
| **D-3** | "打开失败"的**唯一**文本出口从状态栏红字变成 `console.error`（视觉兜底只剩卡片状态点的红色，见 §21 D4） | §16.2 ⑤ 给出"DevTools 里应看到的日志行"作为判据；D4 若选"连卡片错误也移除"，则**视觉兜底彻底消失**——D4 的选项说明里写明这一后果 |

### 0.4 影响面对照（v1 节号 → 本版节号）

`§1`（Goal Mode／触发语）｜`§3`（补第 4 条问题）｜`§4`（方案第 3/5 条改写 + 新增第 6 条）｜`§5.1`（新增 B25–B30 现状事实）｜`§7.3`（界面重写）｜`§8`（用户故事 3/5/6 改写、11 改写、新增 13/14）｜`§9`（用户流程）｜`§10`（前端改动重写）｜`§13`（权限：控制台日志的泄漏面）｜`§15`（错误处理新增"控制台出口"一列说明）｜`§16`（验收新增 16.1 第 7 条 + 16.2 ⑤）｜`§17`（新增 17.1 门禁 + 17.3 逐行改法 + 17.5 关闭）｜`§18`（状态栏相关逐行）｜`§19`（新增 R-8/R-9）｜`§20`（**保持"风险与回退"，回退动作第 3 条改写**）｜`§21`（**原 §20「待决策」→ 现「已关闭决策记录」＋ 新增 D4**）｜`§22`（原 §21 易错点 + 第 4 条）｜`§23`（原 §22 实施顺序 + 前端步拆细）｜`§24`（原 §23 未核实项 + U8）｜`§25`（原 §24 勘误 + 标注"不回改 requirements"）｜`§26`（原 §25 交接，前置闸门改写）｜`§27`（原 §26 摘要，前沿与结论改写）｜**注**：v1 的 §20（「待决策」）与 v2 的 §21（「决策记录」）**同号错位**——本版把"待决策"改名"决策记录"并占 21 号，因此 §20 这个号**在本版不存在**（v1 的 §20 = 本版 §21，v1 的 §21–§26 = 本版 §22–§27）。

---

## 1. Goal Mode 元数据（本规格版本专用）

| 项 | 值 |
| --- | --- |
| Goal Mode | **disabled** |
| 决策来源 | 用户已逐条裁定 v1 的全部待决策（`user-confirmed`，经主代理转达，日期 2026-10-13）；但**未**授权 Goal Mode（自动驾驶） |
| 授权锚点 | `spec ID = rdp-mstsc-detach/spec@v2`；`Authority: local-spec-workflow`；`artifact root = .spec-workflow/rdp-mstsc-detach/`；`decision source = user-confirmed-in-current-conversation (via delegating agent)`；`supersedes = rdp-mstsc-detach/spec@v1` 的待决策状态；`superseded-by = 无` |
| 目标（若将来开启） | 实现本规格 → 通过 §16 验收 → 终审无 must-fix → 达"可发布"结论 |
| 最大自动修复轮次（若将来开启） | 2（skill 默认建议值） |
| 自动提交（若将来开启） | 未授权（默认不给；本仓库发布流程是 commit → tag `v1.0.3` → release 附 `rdp-1.0.3.oix`，应由人来按板机） |
| 暂停条件 | **无阻塞决策**；仍需停下来问用户的只有两类：① §21 D4（卡片红点与错误原文是否也移除——副作用超出"状态栏"字面范围，属产品取舍）；② 任何"要改 obox 宿主"的念头（本规格明确不需要改宿主） |
| 运行期轮次计数 | 由实现阶段的 `implementation-report.md` 维护，本节只存授权元数据；后续实现／审视报告**不得**据此节自行开启或扩大 Goal Mode |

> **Goal Mode 仍为 disabled 的理由**：Goal Mode 是**每个 spec 版本单独授权**的。用户在本次裁定里关闭了 P1/P2/P3/D1/D2/D3，但**没有**说要开自动驾驶；skill 明确禁止从"先前 spec、先前对话、用户偏好历史"推断 Goal Mode。**这不阻塞实现**——只是要求实现阶段按正常节奏走，并在 §21 D4 上先取一次用户意见。

---

## 2. Git 入口（沿用阶段 1 闸门结论，本阶段已复核）

| 仓库 | 分支 | HEAD | 起始状态 | 说明 |
| --- | --- | --- | --- | --- |
| obox（**产物落位**） | `master` | `cc506f1` | 脏基线：**3 行未跟踪**（`.spec-workflow/rdp-mstsc-detach/requirements.md`、`.spec-workflow/webapp-profile-root/requirements.md`、`.spec-workflow/webapp-profile-root/spec.md`） | 产物写在 `.spec-workflow/`（未跟踪）；**不做任何分支/提交操作** |
| `extensions/rdp`（**实现目标**） | `master` | `bfd673c` | **clean**（`git status --porcelain=v1 -uall` 0 行）；tags `v1.0.0`/`v1.0.1`/`v1.0.2`，无分支保护、无 CI | 改动直接落在该仓库 `master`；完成后发 **1.0.3** |

- 分支决策（沿用阶段 1 Q3 选项 A）：**产物在 obox `.spec-workflow/`（未跟踪）；扩展改动在 `extensions/rdp` 的 `master` 上做；完成后发 rdp 1.0.3**（四处版本一致 + tag `v1.0.3` + release 附 `rdp-1.0.3.oix`）。
- 本阶段未做任何 git 操作（无分支、无提交、无 stash）；脏基线原样保留。
- ⚠️ obox 仓库根 `AGENTS.md` 的"分支 + PR + 不得直接推 master"约束**适用于 obox 仓库**；`extensions/rdp` 是独立仓库（`extensions/` 被 obox gitignore），其既定发布流程就是"直接在 master 上 commit → tag → release"，与阶段 1 的用户决策一致。

---

## 3. 问题陈述（用户视角）

rdp 扩展点「打开」时，mstsc 目前是被助手进程**直接** `spawn` 的（`extensions/rdp/helper.cjs:178`）。因此：

1. **进程树里 mstsc 挂在 obox 之下**：任务管理器 / Process Explorer 里能看到 `obox.exe → （IPC 助手 node）→ mstsc.exe` 的父子链。用户的心理模型是"我只是打开了一个系统远程桌面"，而任务管理器告诉他这是 obox 的一部分。
2. **"obox 关了 mstsc 会不会被带走"这件事说不清**：宿主的 IPC 传输层只 `child.kill()` **直接子进程**（`src/main/ipcTransport.ts:120-124`），不做 `taskkill /T` 树杀（宿主里唯一的树杀是 python 运行器 `src/main/pythonCore.ts:194`）。所以现状**多半**不会被连带杀死，但这是"实现细节决定的侥幸"，不是"结构上不可能"——一旦宿主将来改成树杀，或助手被异常终止，结论就变了。
3. **附带代价**：现状的"成功判据"是"拿到 mstsc 的 pid"（`extensions/rdp/index.js:317-330`），这条判据换来的是"界面能显示 pid"；而它**恰恰要求 mstsc 是助手的直接子进程**。也就是说，"能确认真的起来了"与"不是 obox 的后代"在当前实现里是**互斥**的。
4. **（v2 新增）所有结果与告警都要挤进一条底部状态栏**：`已加载 N 个连接`、`已打开 X（mstsc pid N）`、`已删除 X…`、`打开 X 失败：…`，以及 `warnings`（凭据未保存等）与"Windows 安全框里本地资源默认全不勾"这类**操作提示**，全都拼在 `src/App.vue:38-40,52-55,101-106,198,213,229-231,244,269-272` 的 `statusText` 里。用户已明确要求**整个底部状态栏都不要**（与 `extensions/webapp` 保持一致），提示只写控制台；因此本规格把"改文案"升级为"删状态栏"。

## 4. 解决方案（用户视角）

`launch` 改为经 **`cmd.exe /c start`** 派发（用户已在阶段 1 Q1 选定方案 B）：

1. 助手 `spawn('cmd.exe', ['/c', 'start', '', 'mstsc.exe', '<.rdp 绝对路径>'])`；`cmd` 在 **50–65ms** 内退出（真机实测，见 §5.3 P-4），mstsc 的父进程随之变成**已退出的 cmd**。
2. **成功判据换成 `cmd` 退出码 0**（阶段 1 Q2 方案 B）；`launch` 返回 `{ pid: null, path, warnings }`（详见 §7 与 §21 D2）。
3. **（v2 改判）底部状态栏整体删除**（与 `extensions/webapp` 一致）：不再有"最近：…"那一行，也不再有任何界面内提示。所有结果与告警**只写控制台**——成功/普通信息走 `console.info`、失败走 `console.error`，统一前缀 `[rdp]`；**包括** `open` 的 `warnings`（如「凭据可能未保存（TERMSRV/h）」）。原先挂在状态栏上的"Windows 安全框里本地资源默认全不勾"提示**移到 README**（`§13` 已有该条目的完整说明，见 `README.md:329-350`）。
4. **代价（用户已知并接受，R-1）**：`cmd` 退出码 0 只证明"命令已派发"，**不证明 mstsc 真的起来了**。真机实测：把 `.rdp` 路径指向不存在的盘（`Z:\definitely\missing\dir\x.rdp`）时 `cmd` **仍然 exit 0**（mstsc 自己弹框报错）。因此**日志文案必须诚实**（写"已派发 / 已通过 shell 打开"，不写"已连接"），并须在 README「已知行为」里写明这一条（§18）。
5. **失败仍然明确报错**（不静默当成功）：`spawn` 出错、`cmd` 非 0 退出、`cmd` 超时未退出、mstsc.exe 不存在——四种情况各自给可读中文错误，经既有错误通道回包并由 `console.error` 打印（**界面不显示**）。
6. **（v2 新增）告警可见性下降是刻意的**：删掉状态栏后，`warnings` 在界面上**完全不可见**（用户已知情接受）。补偿手段写在 §0.3 D-1：控制台 + README §14「已知行为」+ 统一日志前缀，使排查时能 grep 到。

## 5. 背景与已核实事实

> 标注「真机实测」的条目是本阶段在**本机**（Windows 11 专业版 **Build 26200**，`node v24.14.0`，`mstsc.exe 10.0.26100.8875`）跑探针得到的结论；探针只用 `notepad.exe`（Store 版）与 `cmd /c echo` 代替 mstsc，**没有真的发起过 RDP 会话**。探针脚本落在系统临时目录，**未写进仓库**。

### 5.1 现状代码 / 文档事实

| # | 事实 | 位置 |
| --- | --- | --- |
| B1 | 助手当前 `spawn('mstsc.exe', [rdpPath], { detached: true, stdio: 'ignore' })` + `child.unref()`；`pid` 由 `spawn` 事件回填 | `extensions/rdp/helper.cjs:178-184` |
| B2 | `launch` 文档注释写"返回 `{pid}`（另附 `warnings` 与 `path`）" | `helper.cjs:159-163` |
| B3 | `open` 的"无 pid 即失败"规则 + 原始回复打印 | `extensions/rdp/index.js:317-330`（`const pid = …`、`if (!pid) { console.warn…; return fail(…) }`） |
| B4 | 界面状态栏：`const pid = data.pid` → `已打开 X（mstsc pid N）` | `extensions/rdp/src/App.vue:227-231` |
| B5 | `pid` 在 `src/**` 里**只有这两处**引用（`grep` 全 `src/` 仅命中 App.vue:227,231） | `src/App.vue` |
| B6 | 测试对 `pid` 的断言：mock 回包 `launch: { pid: 4242, … }` 与 `assert.equal(reply.data.pid, 4242)`；文件头注释也写 `→ { pid }` | `extensions/rdp/test/extension.test.js:9,73,297,304` |
| B7 | 另一处 mock 回包 `return { pid: 4242, warnings: [] }`（**只用作返回值，无 pid 断言**） | `extensions/rdp/test/passwordBackfill.test.js:92` |
| B8 | `helper.test.js` 里唯一的 `launch` 用例只测**非法 fileName**（`fileName 非法`），不碰 mstsc | `extensions/rdp/test/helper.test.js:99-108` |
| B9 | 设计文档：`open → 返回 {pid}`、`launch … spawn('mstsc.exe',[rdpPath],{detached:true}).unref() → 返回 {pid}`、状态栏示意 `已打开 …（mstsc pid 12345）` | `docs/spec/rdp-remote-desktop-design.md:119,130,235` |
| B10 | 设计文档另有数据流图写 `spawn mstsc.exe` | `docs/spec/rdp-remote-desktop-design.md:108` |
| B11 | 设计文档 §3.3 已有"`.rdp` 清理：每次 launch 覆盖写同 id 文件；**不做自动清理**" | `docs/spec/rdp-remote-desktop-design.md:133` |
| B12 | README 方法表 `open` 行写 `{ pid, warnings }`（`pid` = 拉起的 `mstsc.exe`） | `extensions/rdp/README.md:73` |
| B13 | README 目录结构写 `helper.cjs`＝"storeCredential / deleteCredential / launch / probe / --selftest"、`lib/cmdkeyArgs.mjs` 等 | `README.md:15-17` |
| B14 | README §9「cmdkey 的两个真机坑」说明 `windowsVerbatimArguments: true` 与 `quoteForCmdkey` 的**由来** | `README.md:186-197` |
| B15 | 版本号四处：`manifest.json:3`、`package.json:3`、`index.js:359`、`package-lock.json:3` 与 `:9`（**只有这两处**是根包版本；`:1294/:2405` 是 `balanced-match`/`util-deprecate` 传递依赖的版本，**不得改**） | 见左 |
| B16 | `scripts/pack.mjs` 白名单含 `lib`（`INCLUDE` 的第 4 项）并递归收集 ⇒ 新增 `lib/*.mjs` **自动进包**，无需改脚本 | `extensions/rdp/scripts/pack.mjs:33-42,49-62,68` |
| B17 | 助手已有"惰性动态 import `lib/*.mjs`（用 `pathToFileURL` 绝对 URL，避免 cwd 影响）"的既有模式 | `helper.cjs:35-43`（`CMDKEY_ARGS_URL` + `cmdkeyArgs()`） |
| B18 | 助手 `--selftest` 只做 `.rdp` 写入/回读 + 文件名防护断言，**不调 cmdkey/mstsc**；本阶段复跑通过（exit 0） | `helper.cjs:281-316`（实跑：`[rdp-helper] selftest 通过（… 未调用 cmdkey/mstsc）`，exit 0） |
| B19 | `lib/connection.mjs` 的校验只有"连接名非空且唯一、主机非空、端口 1–65535"，**没有对路径/文件名做字符白名单** | `lib/connection.mjs:63-84` |
| B20 | 助手 cwd = 扩展 data 目录，`.rdp` 落在 `<data>/rdp/<id>.rdp`；文件名来自 `index.js` 的 `` `${id}.rdp` ``（id 是正整数），**不含用户输入** | `helper.cjs:177`；`index.js:313`；`README.md:53` |
| B25 | 状态栏组件：`<footer class="statusbar">` + 折叠按钮 + `role="status"` 文本，默认展开 | `src/components/StatusBar.vue:17-32`（全文 33 行） |
| B26 | `App.vue` 的状态栏接线：import `:14`；`statusText/statusKind/statusCollapsed` 三个 ref `:38-40`；`setStatus(kind, text)` `:52-55`；模板 `<StatusBar …>` `:377-382` | `src/App.vue` |
| B27 | 状态栏文案共 **8 处**写入点：`refresh()` 成功/失败 `:103,106`；保存成功/失败 `:198,213`；打开成功/失败 `:229-231,244`；删除成功/失败 `:269,272`（另有 `reconcile()` 的注释提到状态栏 `:121`） | `src/App.vue` |
| B28 | 状态栏样式：`flex: 0 0 40px` 固定高 + 折叠态 24px + 三种 kind 配色；另有一条 `.statusbar__toggle:focus-visible` 混在共享焦点规则里 | `src/styles.css:411-457`、`:280-287`（焦点规则，`:284` 是状态栏那条） |
| B29 | 兜底主题表含 `--statusbar-bg` / `--statusbar-fg`；`stylesTokens.test.js` 有一条"兜底表的键必须与宿主 25 个 token **逐条相等**"的强断言（删 token 会直接变红） | `src/theme.js:41-42`；`test/stylesTokens.test.js:22-48`（白名单）、`:126-127`（逐条相等） |
| B30 | **先例**：另一个用户扩展 webapp 已按同样要求删掉状态栏——`setStatus` 保留但只 `console.info/error('[webapp] ' + text)`，并有一条六段式源码门禁 + "兜底表不得留 statusbar token"的两条断言；其注释写明"用户已要求界面不显示操作/错误提示""保留调用点是因为这些日志是唯一的诊断通道" | `extensions/webapp/src/App.vue:90-106`；`test/componentSource.test.js:110-125,140-152`；`src/theme.js:25-27` |
| B31 | 卡片自身的失败反馈**不属于状态栏**：状态点（红）可点开在卡片内展开 `error` 原文；当前**没有任何测试**断言它（`grep cardStates\|showError\|dot--` 在 `test/**` 零命中） | `src/App.vue:42-63,281-284,359-372`；`src/components/ConnectionCard.vue:39-54` |

### 5.2 宿主侧事实（只读核实，本规格**不改宿主**）

| # | 事实 | 位置 |
| --- | --- | --- |
| B21 | 宿主结束 IPC 助手时只 `child.kill()` **直接子进程**，不是树杀 | `src/main/ipcTransport.ts:120-124` |
| B22 | 宿主里唯一的 `/T` 树杀只服务 python 运行器，且实现落在 `pythonCore.ts`（**不是** requirements 里写的 `pythonRun.ts:194`——后者只有 128 行，见 §18 勘误） | `src/main/pythonCore.ts:194`；`pythonRun.ts:8,114` |
| B23 | 助手子进程的环境是**最小集**：只透传 `PATH`、`SystemRoot`、`TEMP`、`TMP`、`HOME`、`USERPROFILE`、`LANG`（**没有** `PATHEXT`、`ComSpec`、`windir`） | `src/main/ipcTransport.ts:27-35` |
| B24 | 同一文件把 `.js/.cjs/.mjs` 助手以 `ELECTRON_RUN_AS_NODE=1` + 宿主自带 Node 拉起（历史坑，已有结论） | `src/main/ipcTransport.ts`（见 `docs/spec/rdp-remote-desktop.md:36`） |

### 5.3 本阶段真机探针结论（决定 §6 的规则）

| # | 结论 | 证据（探针） |
| --- | --- | --- |
| P-1 | `spawn('cmd.exe', ['/c','start','','<目标>','<路径>'])`（`windowsVerbatimArguments` **缺省 = false**）能把**路径原样**交给被启动的进程：`.rdp` 路径含 `空格`、`#`、`&`、`\|`、`<`、`>`、`^`、`(`、`)`、`!`、`%`（字面）**全部原样到达**（用 `Get-CimInstance Win32_Process` 读 `CommandLine` 逐条比对） | 探针 7：`plain/amp/pipe/ltgt/caret/pct/paren/bang` 全部 `exact=Y` |
| P-2 | **`%VAR%` 会被展开**：路径片段 `%TEMP%` 到达目标进程时变成了 `C:\Users\chenzhi\AppData\Local\Temp`（`exact=N`） | 探针 7：`pctvar` → `"C:\obox probe\C:\Users\chenzhi\AppData\Local\Temp\x.rdp"` |
| P-3 | `%` **不配对**时按字面保留：`100% done` 原样到达 | 探针 7：`pct` → `exact=Y` |
| P-4 | `cmd` **立即退出**：`cmd /c start "" notepad.exe <path>` 的 `exit` 事件在 **49/50/56/62/65ms** 触发，退出码 **0**（长路径 30 段 `deep\` 重复时为 **905ms**，仍 exit 0） | 探针 8；探针 10 |
| P-5 | **父进程确实变成死掉的 cmd**：`cmd` pid=15976 → `exit=0 after 62ms`；随后 notepad 的 `ppid=15976`，而 `Get-Process -Id 15976` 为空（"已不存在"）；同一时刻 node（pid 33968）**仍存活** | 探针 10 |
| P-6 | **失败的三种真实形态**：① `start` 一个**不存在的程序名** ⇒ `cmd` **不退出**（探针 8s 未退出，会弹出"选择打开方式"对话框）；② `.rdp` 路径指向不存在的盘 ⇒ `cmd` **exit 0**（mstsc 自己弹框）；③ 把非 `.rdp` 文件喂给 mstsc ⇒ `cmd` **exit 0** | 探针 9 |
| P-7 | 用**批处理文件**冒充目标时 `&`、`\|`、`<`、`>` 会丢——那是"批处理被再次按 cmd 规则解析"造成的**假失败**，与 `start` + `.exe` 无关（P-1 已用真 `.exe` 证伪该假象） | 探针 3 vs 探针 7 |
| P-8 | `%SystemRoot%\System32\mstsc.exe` 在本机存在（`10.0.26100.8875`），`cmd.exe` 也在同一目录 | 本机 `Test-Path`（两者均 True） |

> **P-6①对设计的硬影响**：既然"目标程序名不存在"会让 `cmd` **挂住不退**，那么"`cmd` 退出码 0 = 成功"这条判据在**程序名不存在**时会退化成"超时"而不是"立即失败"。因此本规格要求**先解析 mstsc 的绝对路径并检查存在**（§6.4），把这一分支前移成"明确报错"，不要靠超时兜。

---

## 6. 决策与实现细节：cmd 命令行构造

### 6.1 唯一正确的参数数组形态（可直接照抄）

```js
/**
 * `cmd /c start "" <mstsc 绝对路径> "<.rdp 绝对路径>"` 的参数数组（纯函数，零依赖）。
 * 规则：本函数**不做任何引号/转义**——原样返回；转义由 Node 的 spawn 在
 * `windowsVerbatimArguments: false` 下按"标准命令行解析器"完成（见 §6.2）。
 * @param {string} mstscPath mstsc.exe 的绝对路径（由 resolveMstscPath 得到）
 * @param {string} rdpPath   生成的 .rdp 绝对路径
 * @returns {string[]} 恰好 5 个元素
 * @throws {Error} rdpPath 含 `%VAR%` 变量形态 / 双引号 / 换行（cmd 会吃掉它们，见 §6.3）
 */
/** `%VAR%` 形态（含 `%%`）：cmd 会把它展开成变量值（未定义则是空串）⇒ 路径被静默改写。
 *  ⚠️ 只拦"变量形态"而**不是**任何 `%`：真机矩阵（§6.3、§17）要求 `100% done` 这种
 *  **不配对的单个 `%`** 原样通过 —— 三处口径已统一为"存在一对 `%…%` 即拒绝"。 */
const CMD_VARIABLE_PATTERN = /%[^%]*%/

export function buildStartArgs(mstscPath, rdpPath) {
  const target = String(mstscPath ?? '').trim()
  const file = String(rdpPath ?? '').trim()
  if (!target) throw new Error('buildStartArgs 需要 mstsc 绝对路径')
  if (!file) throw new Error('buildStartArgs 需要 .rdp 绝对路径')
  if (CMD_VARIABLE_PATTERN.test(file)) {
    throw new Error(`.rdp 路径含 %VAR% 变量形态：cmd 会把它当变量展开，无法安全派发（${file}）`)
  }
  if (/["\r\n]/.test(file)) throw new Error(`.rdp 路径含引号或换行，无法安全派发（${file}）`)
  return ['/c', 'start', '', target, file]
}
```

**调用点（`helper.cjs` 的 `launch`）**：

```js
const child = spawn('cmd.exe', buildStartArgs(mstscExePath, rdpPath), {
  windowsVerbatimArguments: false, // 显式写死：见 §6.2「为什么不能是 true」
  detached: true,                  // 助手先死也不带走它（§6.5）
  stdio: 'ignore',
  windowsHide: true
})
```

**为什么不能把整串命令写成一个参数**：那会退化成 `spawn('cmd.exe', ['/c', 'start "" mstsc.exe "C:\\a b\\1.rdp"'])`。Node 在 Windows 上对"含空格的单参数"会**整体加一层引号**，真正的命令行变成 `cmd /c "start "" mstsc.exe "C:\a b\1.rdp""`，`cmd` 的引号消解规则会把里层的引号全部吃掉，结果是 `start` 收到的目标与路径**不是你要的那两个 token**（真机现象：路径在 `&` 处被截断，退出码却仍是 0——静默走错）。**必须用参数数组。**

### 6.2 `windowsVerbatimArguments` 取 **false**（且要显式写出来）

| 取值 | 实际行为 | 在本场景的后果 |
| --- | --- | --- |
| `true` | Node **原样拼接** argv、不加任何引号（"我们已自己拼好"） | 路径里的空格会把 `<path>` 拆成两个 token ⇒ `start` 只看到半截路径。**不可用**，除非我们自己实现 Windows 命令行转义——那是重复 Node 已有的正确实现，且极易出错 |
| `false`（默认，**采用**） | Node 按标准命令行解析器转义：含空白/制表符的参数整体加 `"`；内容里的 `"` 加倍、末尾反斜杠按 MSVCRT 规则处理 | 正是我们要的：路径作为一个整体交给 cmd（真机 P-1 已证 11 类字符全部原样到达） |

> ⚠️ **不要照抄 `runCmdkey` 的 `windowsVerbatimArguments: true`**。`cmdkey` 用的是"它自己的土解析器"，所以要旁路 Node 的转义（`helper.cjs:60-68`、`README.md:194-197`）；`cmd.exe` 用的是"标准解析器"，Node 的转义正是对的。**同一个仓库里两个相反取值，理由完全不同**——这正是本规格要写清、且必须在代码注释里点明的原因（否则下一个人会"统一"成同一个值）。
>
> 显式写 `false` 而不是省略：省略时是默认值，看起来像"没想过"；写死 + 一行注释表示"想过、且不能改成 true"。

### 6.3 引号与转义规则矩阵（含每个字符的处理）

前提：`start` 后面的空 `""` **必须保留**（它是窗口标题占位；没有它时，`start` 会把第一个带引号的参数**当成窗口标题**，路径就丢了——阶段 1 业务规则已定）。

| 字符 | 出现在 `.rdp` 路径里（绝对路径，由扩展生成） | 处理 | 依据 |
| --- | --- | --- | --- |
| 空格 | 常见（`C:\Users\chen zhi\AppData\…`） | 不加引号，由 Node 整体加 `"` | 探针 7 `plain` `exact=Y` |
| 中文 | 常见（`会话 #1.rdp`、中文用户名） | 原样；Node 以 UTF-16 写命令行，目标进程按 UTF-16 读 | 探针 7 `cn`（`Get-CimInstance` 回读的命令行经控制台管道出现乱码，属**管道编码显示问题**，不是命令行本身被改写；Node→cmd→目标 三步都不经过控制台代码页） |
| `&` | **实测原样通过** | 原样 | 探针 7 `amp` `exact=Y` |
| `^` | **实测原样通过** | 原样 | 探针 7 `caret` `exact=Y` |
| `(` `)` | **实测原样通过** | 原样 | 探针 7 `paren` `exact=Y` |
| `!` | **实测原样通过**（延迟展开默认关闭） | 原样；**不**加 `/v:on` | 探针 7 `bang` `exact=Y` |
| `%`（不配对，如 `100% done`） | 字面保留 | 原样 | 探针 7 `pct` `exact=Y`（P-3） |
| `%VAR%`（如 `%TEMP%`） | **会被展开**，路径被静默改写成别的目录 | **拦**：`buildStartArgs` 抛错（§6.1） | 探针 7 `pctvar` `exact=N`（P-2） |
| `"` | 理论上不可达（Windows 文件名不允许 `"`） | **拦**：`buildStartArgs` 抛错 | 保守护栏 |
| `\r` `\n` | 理论上不可达 | **拦**：`buildStartArgs` 抛错 | 保守护栏 |
| `\|` `<` `>` | 实测原样通过；且**不可达**（Windows 文件名不允许） | 原样（不额外拦） | 探针 7 `pipe`/`ltgt` |
| 末尾反斜杠 | 路径以 `.rdp` 结尾 ⇒ **不可达** | 无 | — |

**为什么"只需拦 `%VAR%`"就够**：真正能到达 `buildStartArgs` 的路径只有 `<扩展 data 目录>/rdp/<正整数 id>.rdp`（B20）。扩展 data 目录 = `<userData>/extensions/rdp_chenzhi/data`，其中唯一可能含怪字符的成分是 Windows 用户名（`C:\Users\<名>\…`）。`%VAR%` 要成立需要用户名里同时出现两个 `%`，实际上不可达——但判据只取 **`%…%` 变量形态**（`/%[^%]*%/`）：真机矩阵（§6.3、§17）要求**不配对的单个 `%`**（如 `100% done`）**原样通过**，因此**不能**用 `includes('%')` 一律拒绝；漏判的代价是"路径被静默改写到别的目录"，故保留这条变量形态护栏。（§6.1 的示例代码原写 `includes('%')`，与本矩阵冲突，已按本口径统一。）

### 6.4 mstsc 目标用**绝对路径**，并在派发前检查存在

```js
/** mstsc.exe 绝对路径：优先 %SystemRoot%\System32，缺失时退回盘符相对默认 */
export function resolveMstscPath(env = process.env) {
  const root = String(env.SystemRoot ?? env.windir ?? 'C:\\Windows').replace(/[\\/]+$/, '')
  return `${root}\\System32\\mstsc.exe`
}
```

- **理由 1（R-3 落地）**：`start` 解析程序名依赖 `PATH` + `App Paths` + `PATHEXT`，而宿主只透传最小环境（**没有 `PATHEXT`**，B23）。写成绝对路径把这几个变量从等式里彻底拿掉。
- **理由 2（P-6① 落地）**：程序名解析失败时 `start` 会弹"选择打开方式"对话框并**挂住 `cmd` 不退出**（探针 8 的 8s 未退出）。先自己 `existsSync` 一次，失败就在毫秒级给出可读错误，不把用户丢进一个没有出口的弹框。
- 检查实现：`import { existsSync } from 'node:fs'`，`if (!existsSync(mstscExePath)) throw new Error('未找到 mstsc.exe（远程桌面客户端）：' + mstscExePath)`。
- `%SystemRoot%` 一定存在（宿主透传，B23）；本机实测该文件存在（P-8）。

### 6.5 `detached` / `unref` / `windowsHide` 的取值

| 选项 | 取值 | 理由 |
| --- | --- | --- |
| `detached` | `true` | 保持现有语义：助手若在 `cmd` 退出前被杀，不会连带终止它。`cmd` 本身 ~60ms 就走，这条是"万一"的保险，不是主机制 |
| `unref()` | **保留**（`cmd` 的 `close` 后调用） | 让助手进程不因这个子进程而无法自然退出（与现状 `helper.cjs:183` 一致） |
| `stdio` | `'ignore'` | 现状取值；我们不需要 `cmd` 的输出（错误从退出码与 spawn error 来） |
| `windowsHide` | `true` | 避免控制台窗口闪一下（`mstsc` 本身是 GUI，`cmd` 是控制台程序） |
| `shell` | **不设**（`false`） | 我们自己就是 `cmd.exe`；再加一层 shell 会多一层解析 |

### 6.6 `.rdp` 文件与路径的产生顺序（改前 → 改后）

现状顺序：`storeCredential`（按需）→ `writeRdpFile` → `spawn mstsc`。

改后顺序（**新增一步前置校验，判断"要不要写文件"在写之前**）：

1. `storeCredential`（按需，逻辑不变）；
2. 计算 `rdpPath = join(cwd, 'rdp', assertFileName(fileName))`，并 `resolveMstscPath()`；**先做两项前置校验**（路径字符护栏 + mstsc 存在性）；
3. `writeRdpFile`（逻辑不变，仍是覆盖写）；
4. `spawn` + 等 `cmd` 退出码；
5. 返回 `{ pid: null, path: rdpPath, warnings }`。

> 这样"`%` 路径"与"没有 mstsc"两种情况**不会留下半个 `.rdp` 文件**；而 `cmd` 失败（非 0/超时）时文件**已经写了**——这与现状"spawn 失败但文件已写"一致（现状也是先写后 spawn），属于既有语义，不新增行为。

---

## 7. 成功 / 失败判据与返回契约

### 7.1 `helper.launch` 的返回与错误（改前 → 改后）

| 情形 | 改前 | 改后 |
| --- | --- | --- |
| 成功 | `{ pid: <number>, path, warnings }` | `{ pid: **null**, path, warnings }` |
| `spawn('cmd.exe')` 出错（如 cmd 被策略禁用/缺失） | 抛 `启动 mstsc.exe 失败：<err.message>` | 抛 `启动 mstsc.exe 失败：<err.message>`（**文案不变**，仍然说 mstsc——用户视角要启动的就是 mstsc） |
| `cmd` 非 0 退出 | —（不存在这个分支） | 抛 `启动 mstsc.exe 失败：cmd 退出码 <code>` |
| `cmd` 被信号终止（`code === null`） | — | 抛 `启动 mstsc.exe 失败：cmd 被信号 <signal> 终止` |
| `cmd` 超时未退出 | — | 先 `child.kill()` 再抛 `启动 mstsc.exe 超时（<N>ms 未返回）` |
| mstsc.exe 不存在 | — | 抛 `未找到 mstsc.exe（远程桌面客户端）：<绝对路径>` |
| `.rdp` 路径含 `%`/引号/换行 | — | 抛 `… 无法安全派发（<path>）` |

- 超时值：`START_TIMEOUT_MS = 15_000`（与 `CMDKEY_TIMEOUT_MS` 同风格，同量级；真机正常值 49–905ms，留 16× 余量）。**取值需用户确认（§17 D1）**。
- 这些错误经由既有 JSON-RPC 错误通道冒泡：`helper.cjs` 的 `handleLine` 把 `throw` 转成 `{error:{code:-32603, message}}`（`helper.cjs:251-257`），`index.js` 的 `open` 不在 `try/catch` 内捕获它，但 `api.ipc.request` 会以异常冒泡到 `onMessage` 的 `catch`（`index.js:388-391`）→ `fail(err)` → 界面 `setStatus('error', '打开 X 失败：…')`（`App.vue:242-245`）。**这条链路现状已通，不需要新管道。**

### 7.2 `index.js` 的 `open`（删除"无 pid 即失败"）

改前（`index.js:311-331`）：

```js
const result = await callHelper('launch', { rdpText, fileName: `${id}.rdp`, credential })
if (result && Array.isArray(result.warnings)) warnings.push(...result.warnings)
const pid = result && typeof result === 'object' ? result.pid : null
if (!pid) { /* console.warn + fail('未能拉起 mstsc.exe（helper 回复：…）') */ }
return ok({ pid, warnings })
```

改后：

```js
const result = await callHelper('launch', { rdpText, fileName: `${id}.rdp`, credential })
if (result && Array.isArray(result.warnings)) warnings.push(...result.warnings)
// 判据换成"helper 有没有真的派发成功"：helper 失败时**抛错**（JSON-RPC error），
// 走不到这里；能走到这里且 reply 是对象 ⇒ 已派发。不再要求 pid——cmd /c start
// 派发时 mstsc 不是我们的子进程，拿不到 pid（见 docs/adr/0003）。
if (!result || typeof result !== 'object') {
  let raw
  try { raw = JSON.stringify(result) } catch { raw = String(result) }
  console.warn('[rdp] launch 回复不是对象，helper 原始回复：', raw)
  return fail(`未能拉起 mstsc.exe（helper 回复：${raw ?? '空'}）`)
}
return ok({ pid: result.pid ?? null, path: result.path ?? null, warnings })
```

- **保留**"reply 不是对象 ⇒ 失败"这一条：它钉住的真实故障是"通道没连上/回包为空"（`index.js:158-162` 已有同款告警）。**删掉的只是 pid 判据**，不是全部输入校验——`helper.test.js:99-108` 与 `extension.test.js` 的既有失败分支断言**一条都不削弱**。
- `path` 顺手透出（helper 一直在返回它，B2）；界面不消费，供排查与将来使用。

### 7.3 界面：**删除底部状态栏**（v2 改判，`src/**`）

#### 7.3.1 `src/App.vue` 的 `setStatus`（唯一保留的诊断通道）

改前（`:52-55`）：

```js
function setStatus(kind, text) {
  statusKind.value = kind
  statusText.value = text
}
```

改后（**照 `webapp/src/App.vue:90-106` 的先例**；参数顺序保持 rdp 现有的"kind 在前"，避免改 8 个调用点）：

```js
/**
 * 记录一次操作结果。
 *
 * ⚠️ **用户已要求界面不显示操作/错误提示**（底部状态栏整体移除），因此这里**只写控制台**、不写任何 UI。
 *
 * 为什么保留全部调用点而不是把调用删掉：这些日志是**唯一的诊断通道**
 * （子窗口日志会经主进程转发到终端，前缀 `[child-renderer:*]`）。
 * 出问题时让用户开 DevTools / 看终端即可还原完整过程。
 *
 * @param {'info'|'ok'|'error'} [kind] 成功走 `console.info`、失败走 `console.error`
 * @param {string} text 面向人的一句话
 */
function setStatus(kind, text) {
  if (kind === 'error') console.error(`[rdp] ${text}`)
  else console.info(`[rdp] ${text}`)
}
```

#### 7.3.2 `openConnection` 的成功/失败分支（改前 → 改后）

改前（`:221-246`）：

```js
function openConnection(row) {
  const id = row.id
  clearTimer(id)
  patchState(id, { state: 'opening', error: '', showError: false })
  callExtension('open', { id })
    .then((data) => {
      const pid = data && typeof data === 'object' ? data.pid : data
      patchState(id, { state: 'ok', error: '', showError: false })
      setStatus('ok', `已打开 ${titleOf(row)}${pid ? `（mstsc pid ${pid}）` : ''}${warningSuffix(data)} · Windows 安全框里本地资源默认全不勾（剪贴板等），需要就勾上`)
      timers.set(id, setTimeout(() => { … patchState(id, { state: 'idle', … }) }, 2000))
    })
    .catch((err) => {
      patchState(id, { state: 'error', error: err.message, showError: false })
      setStatus('error', `打开 ${titleOf(row)} 失败：${err.message}`)
    })
}
```

改后（**删 `pid` 读取**；文案改为诚实措辞；**"安全框"提示移出界面**，README §13 已有该说明）：

```js
function openConnection(row) {
  const id = row.id
  clearTimer(id)
  patchState(id, { state: 'opening', error: '', showError: false })
  callExtension('open', { id })
    .then((data) => {
      // 不再读 data.pid：经 cmd /c start 派发拿不到 pid（见 docs/adr/0003）。
      // "已派发"不等于"已连上"——所以文案只承诺派发（§4 第 4 条）。
      patchState(id, { state: 'ok', error: '', showError: false })
      setStatus('ok', `已通过 shell 打开 ${titleOf(row)}${warningSuffix(data)}`)
      timers.set(id, setTimeout(() => { … patchState(id, { state: 'idle', … }) }, 2000))
    })
    .catch((err) => {
      patchState(id, { state: 'error', error: err.message, showError: false })
      setStatus('error', `打开 ${titleOf(row)} 失败：${err.message}`)
    })
}
```

#### 7.3.3 其它 7 处文案（保持原句，只改去向）

| 位置 | 文案（**逐字不改**，下面是源码原文，仅在末尾标注拼进来的 `warningSuffix(data)`） | kind → 出口 |
| --- | --- | --- |
| `App.vue:103` | `已加载 ${rows.value.length} 个连接` | info → `console.info('[rdp] …')` |
| `App.vue:106` | `读取连接列表失败：${err.message}` | error → `console.error` |
| `App.vue:198` | ``已更新连接 ${titleOf(record)}`` / ``已新建连接 ${titleOf(record)}`` | ok → `console.info` |
| `App.vue:213` | `保存失败：${err.message}` | error → `console.error` |
| `App.vue:231`（v2 改写后的那一句） | ``已通过 shell 打开 ${titleOf(row)}${warningSuffix(data)}``（原文是``已打开 ${titleOf(row)}…（mstsc pid ${pid}）… · Windows 安全框里本地资源默认全不勾（剪贴板等），需要就勾上``） | ok → `console.info` |
| `App.vue:244` | `打开 ${titleOf(row)} 失败：${err.message}` | error → `console.error` |
| `App.vue:269` | ``已删除 ${titleOf(row)}，并清理本机保存的凭据${warningSuffix(result)}``（**注意原文那个逗号是全角 `，`**） | ok → `console.info` |
| `App.vue:272` | `删除 ${titleOf(row)} 失败：${err.message}` | error → `console.error` |

> `warningSuffix(data)`（`:126-129`）**保留原样**：`warnings` 仍拼进这句话，只是这句话现在进控制台而不再进界面。**不得**把 `warnings` 从回包或日志里删掉——它是 §17.3 的既有断言与 §24 U8 的排查依据。

#### 7.3.4 删除清单（改前 → 改后，逐项）

| 文件:行 | 改前 | 改后 |
| --- | --- | --- |
| `src/App.vue:14` | `import StatusBar from './components/StatusBar.vue'` | **删除该行** |
| `src/App.vue:38-40` | `const statusText = ref('')` / `statusKind` / `statusCollapsed` | **删除三行** |
| `src/App.vue:377-382` | `<StatusBar :text="statusText" :kind="statusKind" :collapsed="statusCollapsed" @toggle="statusCollapsed = !statusCollapsed" />` | **删除整个块**（6 行 + 前后空行） |
| `src/components/StatusBar.vue` | 33 行组件 | **删除文件** |
| `src/styles.css:280-287` | 共享焦点规则里含 `.statusbar__toggle:focus-visible,` | 删掉该选择器，**保留** `.btn/.input/.select/.dot:focus-visible` |
| `src/styles.css:411-457` | `/* ---------- 状态栏 ---------- */` 注释 + `.statusbar`（`:413-424`）、`.statusbar--collapsed`（`:426-430`）、`.statusbar__toggle`（`:432-443`）、`.statusbar__text`（`:445-449`）、`.statusbar--ok .statusbar__text`（`:451-453`）、`.statusbar--error .statusbar__text`（`:455-457`） | **整段删除**（含分节注释），预计 −48 行 |
| `src/theme.js:41-42` | `'--statusbar-bg': '#2a2a2a',` / `'--statusbar-fg': '#cccccc',` | **删除两行**（兜底表只放真会消费的 token；先例 webapp `theme.js:25-27`） |
| `index.js:57`、`test/passwordBackfill.test.js:188`、`test/helperSanitize.test.js:6` | 注释里"进界面状态栏" | 改为"进控制台/日志"（**纯注释**） |

#### 7.3.5 布局与无障碍

- `.app`（`styles.css:87-92`）是 `height:100vh` 的纵向 flex；`.app__content`（`:132-135`）已是 `flex: 1 1 auto` ⇒ 删掉固定高 40px 的 footer 后内容区**自动多出 40px**，**不需**改任何布局属性。
- 设计文档 §3.9.5 的 Tab 顺序（header → 卡片 → 状态栏，`design:292`）**改为** header → 卡片（末项即最后一个卡片的「删除」按钮）；焦点环规则保留（`.dot` 仍在）。
- `role="status"` 这个无障碍播报点随组件一起消失；控制台日志**不被**屏幕阅读器播报——这是 D-1 的同一类已知代价，记入 README §14。

#### 7.3.6 失败可见性（**必须如实记录**）

删掉状态栏后，"打开失败"在界面上**只剩**卡片状态点的红色（`ConnectionCard.vue:39-49` 的 `.dot--error`），错误原文进 `console.error`。因此：

- 正常用户路径下（不开 DevTools）**只能看到卡片变红**，看不到原因；这是用户已知情接受的代价（§0.3 D-3）。
- §21 D4 若裁定"连卡片错误也移除"，则**连红色都没有**——三个选项的后果已在该条写明，请先裁 D4 再动 `patchState`/`ConnectionCard`。
- 验收判据见 §16.2 ⑤（开 DevTools 看日志行）。

---

## 8. 用户故事

1. 作为 obox 用户，我想让"打开 RDP"拉起的 `mstsc.exe` **不在 obox 的进程树里**，这样我在任务管理器里看到的 mstsc 是一台独立的系统程序，而不是 obox 的一部分。
2. 作为 obox 用户，我想**关掉 obox（正常退出或强杀）之后已经打开的 RDP 窗口仍然在**，这样我不会因为重启 obox 而丢掉正在进行的远程操作。
3. 作为 obox 用户，我想在点「打开」后**马上**（毫秒级）看到状态栏反馈，而不是等一个我不认识的后台进程。
4. 作为 obox 用户，我想在**真的失败**时看到明确的中文原因（"未找到 mstsc.exe"、"cmd 退出码 1"、"超时"），而不是一个"已打开"的假成功。
5. 作为 obox 用户，我想在状态栏里**看不到 pid**（我不关心它是多少，也看不懂），但**仍能看到**"Windows 安全框里本地资源默认全不勾"这条操作提示。
6. 作为 obox 用户，我想在**凭据没预置成功**时仍然照旧看到 warning（"凭据未保存，连接时可能要求输入密码"），这条不能因为换启动方式而消失。
7. 作为**维护这个扩展的开发者**，我想有一条**纯函数**覆盖 cmd 参数构造与转义矩阵，这样我不必真的开一个 RDP 会话就能验证路径不会被 cmd 吃掉。
8. 作为维护者，我想在 README / 设计文档里看到"**为什么用 cmd**"与"**代价是什么**"，这样下次有人质疑"为什么要绕一层 shell"时有据可查。
9. 作为维护者，我想让"命令行转义"这条知识**与 `cmdkey` 的那条相反取值并列写在一处**，这样不会有人把 `windowsVerbatimArguments` "统一"成同一个值而引入静默错误。
10. 作为维护者，我想让版本号、tag、`.oix` 产物一次性对齐到 1.0.3，这样用户装的时候不会看到版本与代码不符。
11. 作为**界面用户**，我想在连接标题里含中文时也一切照旧（打开、状态栏文案），不因为换了启动通道而出现乱码。
12. 作为**回归测试**的读者，我想看到"删掉 pid 判据"这件事在测试里被**显式表达**（而不是被悄悄删掉的断言），这样我知道覆盖没有减少。
13. **（v2 新增）** 作为 obox 用户，我想让这个子窗口**没有底部状态栏**（与 `webapp` 扩展同一形态），这样界面只留"卡片 + 按钮"，不被一行会自己变的文字打扰。
14. **（v2 新增）** 作为**排查问题的用户/维护者**，我想在控制台里看到完整的操作与失败记录（含 `warnings`），这样即使界面不显示提示，我也能在 DevTools / 终端里还原"刚才到底发生了什么"。
15. **（v2 新增，如实验收偏离）** 作为用户，我接受"凭据未保存"这类告警**在界面上看不见**（只能看控制台），因为这是我要求"把提示写成控制台日志"的直接后果（§0.3 D-1）。

---

## 9. 用户流程

```
卡片列表 → 点「打开」
  → index.js open(id)：toId 校验 → 读库行 → 读已存密码（可空）
  → 生成 rdpText（lib/rdpFile.mjs，不变）
  → api.ipc 'rdp.helper' → launch
        → （按需）cmdkey 预置凭据（不变）→ warnings 累积
        → resolveMstscPath()  ── 不存在 ⇒ 抛「未找到 mstsc.exe…」⇒ console.error
        → 计算 rdpPath + buildStartArgs() ── 含 % ⇒ 抛「…无法安全派发」⇒ console.error
        → writeRdpFile（不变）
        → spawn('cmd.exe', ['/c','start','',mstsc,rdpPath]) ⇒ 等 cmd 退出
              ├─ error          ⇒ 抛「启动 mstsc.exe 失败：<msg>」
              ├─ exit 0         ⇒ 成功
              ├─ exit ≠0 / 信号 ⇒ 抛「…失败：cmd 退出码 N」
              └─ >15s 未退出    ⇒ kill + 抛「…超时（15000ms 未返回）」
        → 返回 { pid: null, path, warnings }
  → index.js：warnings 合并 → 回包 { ok:true, data:{ pid:null, path, warnings } }
  → App.vue：
        · 成功 ⇒ console.info('[rdp] 已通过 shell 打开 <标题>（+warnings）')   ← 界面不显示
        · 失败 ⇒ console.error('[rdp] 打开 <标题> 失败：<原因>')               ← 界面不显示
        · 卡片状态点：opening 蓝 → ok 绿 2s → idle 灰；失败红（点开可在卡片内展开错误原文，见 §21 D4）
        · 底部状态栏**不存在**
```

**界面上能看到什么（v2 之后）**：卡片标题/副行/三个按钮、卡片右上角状态点、加载中的一行文案（`App.vue:318` 的 `正在加载连接…`）、空态、搜索框、模态框与删除确认的错误行（`saveError`，`App.vue:33,390`）。**其它一切结果与告警进控制台。**

**mstsc 侧（新语义）**：`cmd` 退出 ⇒ mstsc 的父进程是**已死进程**；obox 退出/被杀**不影响**它（真机 P-5 已用 notepad 证明父进程已死；mstsc 的真机验收见 §16）。

---

## 10. 前端改动（`src/**`）

**本版重写**：v1 是"改状态栏文案"，v2 是"**删状态栏**"。逐项改前 → 改后见 §7.3.4；这里给总量与文件所有权。

| 文件 | 改前 → 改后 | 预计行数 |
| --- | --- | --- |
| `src/App.vue` | 删 import（`:14`）、3 个 ref（`:38-40`）、`<StatusBar>` 模板块（`:377-382`）、`openConnection` 里的 `pid` 读取（`:227`）；`setStatus` 改为只写控制台（`:52-55`）；`openConnection` 成功文案去掉 pid 与"安全框"尾巴（`:229-231`）；注释 `:4,113,121,125` 里"状态栏"措辞同步 | 净 **−14 ~ −18** |
| `src/components/StatusBar.vue` | **删除文件** | −33 |
| `src/styles.css` | 删分节注释 + 6 条 `.statusbar*` 规则（`:411-457`）；共享焦点规则里删 `.statusbar__toggle:focus-visible,`（`:284`） | 净 **−49** |
| `src/theme.js` | 兜底表删 `--statusbar-bg` / `--statusbar-fg`（`:41-42`） | −2 |
| `src/**` 其余（`bridge.js` / `fields.js` / `search.js` / `main.js` / 其它组件） | **不改** | 0 |

- ✅ **必须重跑 `npm run build`**：`ui/index.html` + `ui/assets/*` 里内联着旧的 `App.vue`（含状态栏与 pid 文案）与旧 CSS；不重跑的话 `.oix` 里跑的还是旧界面（§22 步 6）。
- 不需要改 `src/fields.js`（打开流程的输入没变）。
- **不要**顺手改 `src/bridge.js` 的协议：`warnings` 仍要经回包传到页面（只是页面把它写进控制台）。

## 11. 后端改动（`helper.cjs` / `index.js` / `lib/**`）

| 文件 | 改动 | 预计行数 |
| --- | --- | --- |
| `lib/mstscArgs.mjs`（**新增**） | `buildStartArgs(mstscPath, rdpPath)` + `resolveMstscPath(env)`，纯函数零依赖，带头部中文注释解释"为什么 false、为什么不能整串" | +55 ~ 70（含注释与 JSDoc） |
| `helper.cjs` | ① 新增 `MSTSC_ARGS_URL` + `mstscArgs()` 惰性 import（照 `:35-43` 的既有模式，+8 行）；② `launch` 的 spawn 段整段替换（`:177-185`）为"校验 → 写文件 → spawn cmd → 等退出码"（约 −6/+40）；③ 新增 `START_TIMEOUT_MS = 15_000`（`:28` 附近 +2）；④ 顶部"方法"注释补一句"launch 经 cmd /c start 派发"（`:17` 一行改写）；⑤ `selftest()` 内新增 argv 矩阵断言段（`:300` 附近 +35）；⑥ 文件头 `import` 行补 `existsSync`（`:20` 那一行改写） | 净 +85 ~ 95 |
| `index.js` | `open` 的 `:317-330` 换成 §7.2 的 5 行判据；`:359` 版本 `'1.0.2'` → `'1.0.3'`；`open` 的 JSDoc/注释同步（若写了） | 净 +2 ~ 6 |
| `lib/rdpFile.mjs` / `lib/cmdkeyArgs.mjs` / `lib/connection.mjs` | **不改** | 0 |
| `scripts/pack.mjs` | **不改**：`INCLUDE` 已含 `lib` 并递归收集（B16），新模块自动进包 | 0 |
| `manifest.json` | `"version": "1.0.2"` → `"1.0.3"` | 1 行 |
| `package.json` | `"version": "1.0.2"` → `"1.0.3"` | 1 行 |
| `package-lock.json` | `:3` 与 `:9` 两处 `"1.0.2"` → `"1.0.3"`；**`package-lock.json:1294`/`:2405` 是传递依赖版本，禁止改**（B15） | 2 行 |
| `index.js:359`（卡片 version） | → `'1.0.3'`（与上表同文件，单列以免漏） | 1 行 |

### 11.1 ⚠️ `lib/` 必须进包（本条是审查重点，别再踩）

需求里"`helper.cjs` 是单文件"的印象**不成立**：`helper.cjs` 已经用"`pathToFileURL(join(__dirname,'lib',…))` + 惰性动态 `import()`"加载 `lib/cmdkeyArgs.mjs`（B17），`scripts/pack.mjs` 的白名单也已含 `lib`（B16）。所以新增 `lib/mstscArgs.mjs` **与既有约定完全一致**，只需在 `scripts/pack.mjs` 之外确认打包产物里能看到该条目（验收 §16.1 第 3 条列出命令）。

### 11.2 界面侧的统一日志契约（v2 新增；删状态栏后的唯一出口）

| 触发 | 出口 | 文本（`<…>` 为变量） | 备注 |
| --- | --- | --- | --- |
| 列表加载成功 | `console.info` | `[rdp] 已加载 <N> 个连接` | `refresh()` |
| 列表加载失败 | `console.error` | `[rdp] 读取连接列表失败：<原因>` | |
| 保存成功 | `console.info` | `[rdp] 已新建连接 <标题>` / `[rdp] 已更新连接 <标题>` | |
| 保存失败 | `console.error` | `[rdp] 保存失败：<原因>` | 模态框内仍显示 `saveError`（`:390`），**不动** |
| 打开成功 | `console.info` | `[rdp] 已通过 shell 打开 <标题>（<warnings 用；连接>）` | 无 warnings 时无括号段 |
| 打开失败 | `console.error` | `[rdp] 打开 <标题> 失败：<原因>` | 界面上只剩卡片红点（§21 D4） |
| 删除成功 | `console.info` | `[rdp] 已删除 <标题>，并清理本机保存的凭据（<warnings>）` | |
| 删除失败 | `console.error` | `[rdp] 删除 <标题> 失败：<原因>` | |

- **前缀统一 `[rdp]`**：与 `index.js` 既有 `[rdp]` 前缀一致（`index.js:160,255,327,389`），便于在混流的终端里 grep。
- **脱敏不变**：这些文本全部来自既有链路（`messageOf`/`warnings`/`secretErrorText`），密码面不扩大（§13）。`console.error` 的第二参数（原生 Error 对象）**不要**传——现状 `setStatus` 只传字符串，保持"一句话"便于阅读（`index.js:389` 那边已有 `console.error('[rdp] …', err)` 的完整错误打印，不重复）。
- 子窗口日志会经宿主转发到终端（前缀 `[child-renderer:*]`，先例说明见 `extensions/webapp/src/App.vue:96-98`），因此**不开 DevTools 也能在 obox 终端看到**。

## 12. 数据模型与数据库

**Not applicable。** 本改动不涉及任何表、列、索引或迁移：`rdp.db` 的列集由 `lib/rdpFile.mjs` 的 `RDP_FIELDS` 与 `lib/connection.mjs:99-117` 决定，本次一行不改；`.rdp` 文件内容也不变（`buildRdpText` 不动）。

## 13. 权限与安全

- **不新增任何宿主 API、不扩大文件访问面**：仍然只有 `api.sqlite` / `api.secrets` / `api.ipc`（`manifest.json` 的 `ipcChannels` 不变）。
- **新增的系统面**：执行 `cmd.exe`（Windows 自带）。这是**刻意的**（为了拿到"父进程立即退出的孤儿"），必须在 README 写明：
  - 传给 `cmd` 的**命令行不来自自由文本**：`mstsc` 目标由 `resolveMstscPath(process.env)` 得出；`.rdp` 路径 = `<cwd>/rdp/<正整数 id>.rdp`，其中"`cwd` 由宿主决定、文件名由扩展生成"（B20）。用户可控的只有连接的 `name/host/port/…` 字段，它们进的是 `.rdp` **文件内容**，**不进命令行**。
  - 不引入 shell 二次解析：`shell: false`（§6.5）；不使用 `exec`/`execSync` 字符串形态。
  - 不新增对 `%` 的转义技巧（cmd 里没有安全的转义），而是**拒绝**该类路径（§6.3）。
- 密码面不变：仍只经 `cmdkey` 的 argv（既有已接受风险，`README.md:165`），`cmd` 这条路上**不碰密码**。
- 审计面不变：`warnings` 与 `console.warn` 的既有脱敏（`sanitizeCmdkeyText`、`secretErrorText`）全部保持；新增的三条错误文案**不含**密码与任何 secret（它们是路径/退出码文本）。
- **（v2 新增）日志出口变了，脱敏口径不变**：状态栏没了之后，`warnings`/错误文本的**唯一**出口是控制台（§11.2）。因此"**界面里不得出现密码**"这条约束自动弱化（界面已无文本出口），但"**日志里不得出现密码**"这条**反而更关键**——现有三道防线继续适用，且**不得**因为"反正只在控制台"而放松：
  1. `helper.cjs:76-78` 的 `sanitizeCmdkeyText`（把 `/pass:xxx` 擦成 `/pass:***`）；
  2. `index.js:60-64` 的 `secretErrorText`（把已知密码从异常文案里擦掉）；
  3. `index.js:298-299,347-352` 的"密码只经返回值流转、不打印"约定。
- **（v2 新增）控制台里会出现的东西**：连接标题（`username@host:port`）、`.rdp` 绝对路径、`cmd` 退出码、`warnings` 原文。**不含**密码、不含 `conn:<id>` 的 secret 值。密码只在 `cmdkey` 的 argv 里短暂出现（既有已接受风险，`README.md:165`）。
- **（v2 新增）用户已知的可见性下降**：告警不再进界面（§0.3 D-1）。这不是安全问题，是**可诊断性**问题；补偿手段见 §0.3 D-1，且**必须**在 README §14 写明"出问题请开 DevTools / 看终端"。

## 14. 性能与可伸缩性约束

- `cmd` 派发的额外开销：真机 **49–905ms**（P-4；905ms 是 30 层深路径的最坏观测值，正常路径 ~60ms）。相对现状（直接 `spawn` 后立即返回）**新增一次进程创建 + 一次退出等待**，用户可感知差异约 0.1s 量级。
- `START_TIMEOUT_MS = 15_000` 只作"cmd 挂住"的兜底（P-6① 的真实形态），不是常见路径；超时后必须 `kill()`，**不留僵尸 cmd**。
- 不引入轮询、不引入新的常驻进程；不改变 60s 的 IPC 超时（`index.js:157`）。

## 15. 错误处理与边界条件

> 全表更新：所有"用户可见行为"列在 v2 之后都指**控制台**（界面无提示；唯一例外是模态框内的字段错误行与卡片红点，见 §7.3.6）。

| 场景 | 期望 | 落点 |
| --- | --- | --- |
| `cmd.exe` 不存在 / 被策略禁用 | `spawn` 的 `error` 事件 → `fail('启动 mstsc.exe 失败：<msg>')`；页面 `console.error('[rdp] 打开 <标题> 失败：<msg>')`；卡片红点 | `launch`（§7.1） |
| `cmd` 非 0 退出 | `fail('启动 mstsc.exe 失败：cmd 退出码 N')`；同上 | `launch` |
| `cmd` 超时 | `kill()` + `fail('启动 mstsc.exe 超时（15000ms 未返回）')`；同上 | `launch` |
| mstsc.exe 不存在 | `fail('未找到 mstsc.exe（远程桌面客户端）：<路径>')`，**不写 .rdp** | `launch` 前置校验 |
| 路径含 `%`/`"`/换行 | `fail('…无法安全派发（<path>）')`，**不写 .rdp** | `buildStartArgs` |
| `cmd` 0 退出但 mstsc 实际没起来 | **接受**：返回成功，日志写"已通过 shell 打开"（§4 第 4 条、§21 D2）；**不得**把文案写成"已连接/已打开会话"；README「已知行为」必须写明 | `App.vue` 日志文案 + §18 |
| 同一 `.rdp` 重复打开 | 与现状一致：mstsc 自行处理多窗口/复用；不做去重 | 无改动 |
| 凭据未预置成功 | 照旧进 `warnings` → **拼进 `console.info` 那句**，**不阻断**打开 | `launch` 既有逻辑 + §11.2 |
| `.rdp` 文件已存在 | 覆盖写（现状） | `writeRdpFile` |
| 路径含中文 | 正常（P-1 `cn`；Node↔cmd 全程 UTF-16，不经控制台代码页） | 无特殊处理 |
| 路径超长（>260 字符） | 真机 30 层 `deep\` 仍成功（P-4）；**不承诺**去掉长路径限制（`\\?\` 前缀不支持 `.rdp` 语义，`mstsc` 对 UNC/长路径的行为未验证 ⇒ 记为未验证项 U5） | README「已知限制」 |
| `rdpText` 为空/`fileName` 非法 | 现状行为不变（`assertFileName` 抛 `fileName 非法`） | 不改 |
| 退出码为 `null`（信号终止） | `fail('…被信号 <signal> 终止')` | `launch` |
| **（v2）页面拿不到 `warnings` 时** | `warningSuffix` 返回空串 ⇒ 日志里没有括号段；**不得**因此把 `warnings` 从回包里去掉 | `App.vue:126-129` 不改 |
| **（v2）用户不知道去哪看失败原因** | README §14「已知行为」+ §7「已知限制」写明"提示只在控制台（DevTools / obox 终端）" | §18 文档同步 |

## 16. 验收标准

### 16.1 自动化（可在本机无人类介入跑完）

1. `cd extensions/rdp && npm test` **全绿**（含新增 `test/mstscArgs.test.js`）。
2. `node helper.cjs --selftest` **exit 0**，输出仍含 `selftest 通过`，且**新增的 argv 矩阵断言**随之内嵌通过（不真启动 mstsc/cmd）。
3. `npm run build && npm run pack` 产出 `out/rdp-1.0.3.oix`；`node -e` 读回 zip 的中央目录条目，**必须能看到 `lib/mstscArgs.mjs`**（B16 的落地验证），且**不含** `data/`。
4. `validate-manifest.mjs` 0 error（仓库既有命令，见设计文档 §6 第 4 条）。
5. 版本号一致性：`manifest.json` / `package.json` / `package-lock.json`（仅 `:3`、`:9`）/ `index.js` 卡片 `version` **四处**都是 `1.0.3`。
6. `npx prettier --check`（扩展目录）通过。
7. **（v2 新增）状态栏移除的自动化判据**：`test/componentSource.test.js` 的"状态栏已移除"门禁通过 + `test/stylesTokens.test.js` 的"兜底表不得留 `--statusbar-*`"通过（§17.1/§17.3）。另用一条独立命令确认**编译产物里也没有**：
   ```powershell
   cd extensions\rdp
   Select-String -Path ui\assets\*.js -Pattern 'statusbar|mstsc pid' -SimpleMatch   # 期望 0 命中
   Select-String -Path ui\assets\*.css -Pattern 'statusbar' -SimpleMatch           # 期望 0 命中
   ```
   > ⚠️ 只在 `src/`、`ui/`、`test/` 里扫。**`docs/evidence/**` 里有旧构建产物快照**（`docs/evidence/rdp-ui-shots/**`、`align-shots/**` 的 `index-*.js` 含 pid/状态栏字面量），它们是**历史证据、不得修改**，也不进 `.oix`（`pack.mjs:33-44` 的白名单只有 manifest/index/helper/lib/ui/icon/LICENSE）——全局 grep 命中它们属正常，不要"顺手清理"。

### 16.2 真机清单（**必须人工执行**，逐条给判据）

> ⚠️ 验收会真的弹出 mstsc 窗口。若你的目标是"只看进程树、不进会话"，用**一个指向不可达地址的 `.rdp`**（会停在连接失败/凭据框），验收完手动关掉窗口即可。
> 所有命令都在 **pwsh** 里跑。

**① 父进程不是 obox / 助手**

```powershell
# 1) 记下 obox 与助手的 pid 家族
Get-CimInstance Win32_Process -Filter "Name='obox.exe' OR Name='electron.exe'" |
  Select-Object ProcessId, ParentProcessId, Name
(Get-CimInstance Win32_Process -Filter "Name='node.exe'").ProcessId     # 助手是 node 形态
# 2) 点扩展里的「打开」，然后：
Get-CimInstance Win32_Process -Filter "Name='mstsc.exe'" |
  Select-Object ProcessId, ParentProcessId, CommandLine
# 3) 逐条确认 mstsc 的 ParentProcessId：
#    - 该 pid 在 Get-Process -Id <ppid> 里查不到（父进程已退出）
#    - 该 pid 不等于步骤 1 里任何一个 obox/助手 pid
#    （即：既不是 obox，也不是仍活着的助手 —— 是一条已断开的链）
```
判据：`mstsc.exe` 的 `ParentProcessId` **查不到对应活进程**，且**不在** obox/助手 pid 集合里。
（本阶段已用 `notepad.exe` 替身走通同款判据：`ppid=15976` → `(已不存在)`，探针 10 = P-5。）

**② 关闭 obox 后 mstsc 仍在**

```powershell
# 打开一个 RDP（同上），确认 mstsc 在：
(Get-Process mstsc -ErrorAction SilentlyContinue | Measure-Object).Count   # 期望 ≥1
# 关掉 obox：正常退出走界面；"被杀"场景用：
Get-Process obox,electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
# 再看：
(Get-Process mstsc -ErrorAction SilentlyContinue | Measure-Object).Count   # 期望 ≥1（与关闭前相同）
```
判据：obox 进程全部消失后，`mstsc.exe` **仍在**（窗口不关、计数不减）。
（对照组：现状直接 `spawn` 时，助手被 `child.kill()` 后 mstsc 通常也还在——所以"仍在"这条**区分不了新旧实现**；能区分的是 ① 的父子关系。② 的价值是排除"被连带杀死"这一最坏情况。）

**③ 含特殊字符的路径仍能拉起**

```powershell
# 造一个含空格/中文/&/^/(/) 的扩展数据目录是不可行的（目录名由宿主决定），
# 因此这一条用"直接对 helper 的纯函数 + 一次替身 start"验证：
cd extensions\rdp
node -e "import('./lib/mstscArgs.mjs').then(m=>{for(const p of ['C:\\a b\\1.rdp','C:\\会话 #1.rdp','C:\\a&b\\1.rdp','C:\\a^b\\1.rdp','C:\\(a) b\\1.rdp','C:\\a!b\\1.rdp','C:\\100% done\\1.rdp']) console.log(JSON.stringify(p), '=>', JSON.stringify(m.buildStartArgs('C:\\Windows\\System32\\mstsc.exe', p)))})"
# 期望：每组都是长度 5 的数组，且第 5 个元素与输入**逐字符相同**（不做任何引号处理）
```
判据：7 组输出全部满足上述形态；**并且**含 `%VAR%` 形态的路径**抛错**：
```powershell
node -e "import('./lib/mstscArgs.mjs').then(m=>{try{m.buildStartArgs('C:\\Windows\\System32\\mstsc.exe','C:\\%TEMP%\\1.rdp');console.log('未抛错 => 不合格')}catch(e){console.log('已拒绝 =>', e.message)}})"
```
真机"端到端"版（可选，用替身程序，不碰 mstsc）：
```powershell
# 用 notepad 当替身，验证"start 派发 + 路径原样到达"
cmd /c start "" notepad.exe "C:\obox probe\a&b\会话 #1.rdp"
Get-CimInstance Win32_Process -Filter "Name='notepad.exe'" | Select-Object CommandLine
# 期望 CommandLine 里能看到完整的 "C:\obox probe\a&b\会话 #1.rdp"（本阶段实测如此，P-1）
```

**④ `cmd` 失败时的报错可见**（v2 之后**界面不再显示任何提示**，报错只进控制台）

```powershell
# 场景 A：mstsc 不存在 —— 临时把解析结果指到不存在的路径不可行（由 env 决定），
# 因此用"路径含 %"这条**必然失败**的分支验证报错链路（走的是同一条 fail 通道）：
#   临时把 <扩展 data>\rdp 放到一个含 % 的路径下不可行 ⇒ 改为直接调用 helper 的 launch：
cd extensions\rdp
'{"jsonrpc":"2.0","id":1,"method":"launch","params":{"rdpText":"full address:s:1.2.3.4\r\n","fileName":"1.rdp"}}' |
  node helper.cjs
# 期望：{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"…"}} —— 或成功回包
#        {"jsonrpc":"2.0","id":1,"result":{"pid":null,"path":"…","warnings":[]}}
```
判据：返回的 `result` 里 **`pid` 字段存在且恒为 `null`**，`path` 指向 `<cwd>/rdp/1.rdp`，`warnings` 是数组。
**界面侧判据（v2 改写）**：**界面上不出现任何"已打开/失败"文字**（状态栏已不存在）；失败时**只有卡片状态点变红**，原因只在控制台。

**⑤ （v2 新增）控制台日志判据 —— 取代原"看状态栏"的验收**

开子窗口 DevTools（`Ctrl+Shift+I`；或在 obox 终端里看宿主转发的 `[child-renderer:*]` 日志），**必须**逐条命中：

| 操作 | 期望在控制台看到 | 级别 |
| --- | --- | --- |
| 打开卡片（成功） | `[rdp] 已通过 shell 打开 <标题>`；若凭据未预置成功，同句带 `（凭据可能未保存（TERMSRV/h）：…）` | `info` |
| 打开卡片（失败：手工把扩展 data 目录改名/加权限，或断网触发凭据失败后再打开） | `[rdp] 打开 <标题> 失败：<中文原因>` | `error` |
| 新建/编辑保存成功 | `[rdp] 已新建连接 <标题>` / `[rdp] 已更新连接 <标题>` | `info` |
| 删除成功 | `[rdp] 已删除 <标题>，并清理本机保存的凭据` | `info` |
| 首次加载 | `[rdp] 已加载 <N> 个连接` | `info` |

判据：**⑤ 的每一行都能看到**，且**界面上一个字都没有**（除了卡片状态点与模态框内的字段错误）。若日志缺失 ⇒ D-1 的补偿手段失效，**视为验收不通过**（因为界面上已经没有任何其它渠道）。
> 反例（必须不出现）：控制台里出现 `password`、`/pass:` 明文、或 secret 值 ⇒ 直接影响 §13 的脱敏结论，验收不通过。

### 16.3 三条"不得削弱"的既有断言

1. `test/helper.test.js:99-108`（`fileName 非法` → `-32603`）**必须继续通过**。
2. `test/extension.test.js:321-328`（无密码时 `credential` 为 `null`）与 `:330-335`（id 非法/连接不存在）**必须继续通过**。
3. `test/passwordBackfill.test.js:173-199`（密码不得出现在 `open` 回包/日志/`.rdp` 文本里）**必须继续通过**。

## 17. 测试计划与测试决策

### 17.1 （v2 新增）"状态栏已移除 + 只写控制台"的源码门禁（推荐加进 `test/componentSource.test.js`）

**照 `extensions/webapp/test/componentSource.test.js:110-125` 的六条断言写**（该文件的 `source()` 会剥掉注释，避免"文档里写的示例"喂成假绿，`componentSource.test.js:14-20`）：本文件现在只读 `src/components/**`，**需要补一个读 `../src/App.vue` 的 helper**（webapp 那边叫 `APP`）：

```js
test('状态栏已移除：组件、模板用法、状态字段与 CSS 规则都不得复活', () => {
  assert.ok(!APP.includes('StatusBar'), 'App.vue 不得再引用 StatusBar')
  assert.ok(!APP.includes('statusText'), 'App.vue 不得再有 statusText 状态')
  assert.ok(!APP.includes('statusKind'), 'App.vue 不得再有 statusKind 状态')
  assert.ok(!APP.includes('statusCollapsed'), 'App.vue 不得再有 statusCollapsed 状态')
  assert.ok(!APP.includes('statusbar'), 'App.vue 不得再有 statusbar 相关标记')
  assert.ok(!STYLES.includes('.statusbar'), 'styles.css 不得再有 .statusbar 规则')
  assert.ok(
    !existsSync(fileURLToPath(new URL('../src/components/StatusBar.vue', import.meta.url))),
    'src/components/StatusBar.vue 必须已删除'
  )
  // 但 setStatus **必须保留**（唯一的诊断通道，只是改为只写控制台）
  assert.ok(APP.includes('function setStatus('), 'setStatus 必须保留为诊断通道')
  assert.ok(APP.includes('console.error(`[rdp] ${text}`)'), '失败文案必须走 console.error')
  assert.ok(/console\.info\(`\[rdp\] \$\{text\}`\)/.test(APP), '普通文案必须走 console.info')
  assert.ok(!APP.includes('statusText.value ='), 'setStatus 不得再写任何响应式 UI 状态')
  assert.ok(!APP.includes('mstsc pid'), '界面源码里不得再出现 pid 文案')
})
```

配套两条 token 断言（写在 `test/stylesTokens.test.js`，照 webapp `:140-152`）：

```js
// 状态栏已删除 ⇒ 兜底表不得留 statusbar token（但宿主白名单仍是 25 项，不动）
assert.ok(!('--statusbar-bg' in FALLBACK_TOKENS), '兜底表不得再留 --statusbar-bg')
assert.ok(!('--statusbar-fg' in FALLBACK_TOKENS), '兜底表不得再留 --statusbar-fg')
```

> **注意**：`HOST_THEME_TOKEN_NAMES`（`stylesTokens.test.js:22-48`）是**宿主**的白名单，**必须保持 25 项**；只有"兜底表 == 宿主白名单"那条（`:126-127`）要改（§17.4）。

### 17.2 新增纯函数测试（推荐新增 `test/mstscArgs.test.js`）

| 用例 | 断言 |
| --- | --- |
| 参数数组形态 | `assert.deepEqual(buildStartArgs(MSTSC, 'C:\\d\\1.rdp'), ['/c','start','',MSTSC,'C:\\d\\1.rdp'])`；`length === 5`；`args[2] === ''`（**空标题占位必须存在**） |
| **转义矩阵（6+ 组）** | 表驱动：`C:\obox probe\1.rdp`（空格）、`C:\会话 #1.rdp`（中文）、`C:\a&b\1.rdp`、`C:\a^b\1.rdp`、`C:\(a) b\1.rdp`、`C:\a!b\1.rdp`、`C:\100% done\1.rdp`（`%` 不配对）；**每组断言 `args[4]` 与输入严格相等**（函数不加引号、不转义、不截断） |
| 拒绝矩阵 | `%TEMP%` → `/含 %/` 抛错；`a"b` → `/引号或换行/` 抛错；`a\nb` → 抛错；空路径/空 mstsc → 抛错 |
| `resolveMstscPath` | `{SystemRoot:'C:\\WINDOWS'}` → `C:\WINDOWS\System32\mstsc.exe`；`{SystemRoot:'C:\\WINDOWS\\'}`（尾反斜杠）→ 不出现 `\\` 双斜杠；`{}` → 退回 `C:\Windows\System32\mstsc.exe`；`{windir:'D:\\Win'}` → `D:\Win\System32\mstsc.exe` |
| 回归护栏（防"好心加引号"） | `assert.ok(!args.some(a => a.startsWith('"') && a.endsWith('"')))`——函数**永远不自己加引号**；这条防止后人"照着 `quoteForCmdkey` 的样子"给这里也加一层，从而破坏 Node 的转义 |

### 17.3 `--selftest` 内嵌断言（不改"不真启动"约束）

在 `helper.cjs` 的 `selftest()` 里追加一段（沿用现有 `assert` 风格，`:288-306`）：

```js
// 新增：cmd 命令行构造的纯函数矩阵（同样**不**启动 cmd/mstsc）
const { buildStartArgs, resolveMstscPath } = await mstscArgs()
const mstsc = resolveMstscPath({ SystemRoot: 'C:\\WINDOWS' })
for (const p of ['C:\\obox probe\\1.rdp', 'C:\\会话 #1.rdp', 'C:\\a&b\\1.rdp', 'C:\\a^b\\1.rdp',
                 'C:\\(a) b\\1.rdp', 'C:\\a!b\\1.rdp', 'C:\\100% done\\1.rdp']) {
  const args = buildStartArgs(mstsc, p)
  assert.equal(args.length, 5, 'cmd 参数必须是 5 个')
  assert.equal(args[2], '', 'start 的空标题占位不能丢')
  assert.equal(args[4], p, '路径必须原样传（不加引号/不转义）')
}
assert.throws(() => buildStartArgs(mstsc, 'C:\\%TEMP%\\1.rdp'), /含 %/)
assert.throws(() => buildStartArgs(mstsc, 'C:\\a"b\\1.rdp'), /引号或换行/)
```

**为什么不在这里真的启动**：`--selftest` 的既有契约就是"不调 cmdkey/mstsc"（B18、`README.md:39`），真启动会让它从"纯自测"变成"会弹窗的测试"。真启动留给 §16.2。

### 17.4 必须修改的既有断言（逐条 `文件:行`）

| 文件:行 | 现状 | 改法 |
| --- | --- | --- |
| `test/extension.test.js:73` | `launch: { pid: 4242, path: 'C:\\data\\rdp\\1.rdp', warnings: [... ] }` | 改为 `launch: { pid: null, path: 'C:\\data\\rdp\\1.rdp', warnings: [...] }`（**只改 pid 值，其余保留**） |
| `test/extension.test.js:304` | `assert.equal(reply.data.pid, 4242)` | 改为 `assert.equal(reply.data.pid, null)` **并新增** `assert.equal(reply.data.path, 'C:\\data\\rdp\\1.rdp')`、`assert.deepEqual(reply.data.warnings, ['凭据可能未保存（TERMSRV/h）'])`（把"成功"的判据**换成 path/warnings 存在**，不是简单删断言） |
| `test/extension.test.js:9` | 文件头注释 `→ { pid }` | 改为 `→ { pid: null, path, warnings }（cmd /c start 派发，不要求 pid）` |
| `test/extension.test.js:297` | 用例名 `…返回 pid` | 改为 `…返回 { pid:null, path }，不要求 pid` |
| `test/passwordBackfill.test.js:92` | `return { pid: 4242, warnings: [] }` | 改为 `return { pid: null, path: 'C:\\data\\rdp\\1.rdp', warnings: [] }`（该文件**无 pid 断言**，B7；改它是为了让 mock 与真实契约同形，避免"mock 比现实更宽松") |
| `test/helper.test.js`（**v2 关闭**：按 §21 D3 的裁定 A **不加**"真派发"用例） | — | **不加**。原因：单测会真的弹出 mstsc 窗口（D3 选项 B 的硬缺点）；回包形状由 §17.2 纯函数用例 + §17.3 内嵌矩阵 + `test/extension.test.js` 的 mock 契约三处覆盖，真机语义由 §16.2 人工验收覆盖 |
| `test/stylesTokens.test.js:126-127` | `assert.deepEqual(keys, [...HOST_THEME_TOKEN_NAMES].sort())`（兜底表必须与宿主 25 项逐条相等） | 改为**子集 + 显式点名**：断言"兜底表的每一项都在宿主白名单内"（保留 `:120-125` 那条集合包含）+ 新增"界面消费的 token 都有兜底"（`:113-118` 已有，保持）+ **删除"逐条相等"**这半句，并按 §17.1 追加两条"不得留 `--statusbar-bg/fg`"。**宿主白名单 `:22-48` 保持 25 项不动** |
| `test/stylesTokens.test.js`（新增用例） | — | 见 §17.1 的两条 statusbar token 断言 |
| `test/componentSource.test.js`（新增用例） | — | 见 §17.1 的"状态栏已移除"门禁；需要新增一个读 `../src/App.vue` 的 `APP` 常量与 `STYLES` 常量（后者可复用 `stylesTokens.test.js` 的读法） |
| `test/passwordBackfill.test.js:188` | 断言消息 `'open 的回包（进状态栏）里不得出现密码'` | 改为 `'open 的回包（只进控制台）里不得出现密码'`（**断言条件不变**，只改消息文本，避免测试输出与现状脱节） |
| `test/helperSanitize.test.js:6` | 文件头注释"进界面状态栏、也进 `console.error`" | 改为"进控制台（`console.error`/`console.info`）"（**注释**） |
| `index.js:57` | 注释"会经 `fail()` 的回包进界面状态栏" | 改为"会经 `fail()` 的回包进控制台日志"（**注释**） |

### 17.5 测试接缝选择（遵循既有模式）

- **界面无关的纯逻辑接缝**：`lib/mstscArgs.mjs`（与 `lib/cmdkeyArgs.mjs`、`lib/rdpFile.mjs` 同层，`node --test` 直接 import；先例：`test/cmdkeyArgsQuoting.test.js`）。这是**最高可用接缝**：它验证的正是"命令行会不会被吃掉"这件事的核心。
- **入口消息契约接缝**：`index.js` 的 mock api（先例：`test/extension.test.js`）——验证"pid 判据已删、失败分支仍在"。
- **不新增更低的接缝**：不 mock `node:child_process`（会与真实 cmd 语义脱钩），不引入测试框架。
- **真机语义**（父进程已死、obox 关掉 mstsc 仍在）**不进单测**：它需要真实窗口与进程树，属 §16.2 人工验收。

### 17.6 测试决策（v2：已关闭）

| 项 | 裁定 |
| --- | --- |
| 测试接缝 | **已关闭 = §21 D3 选项 A**：`lib/mstscArgs.mjs` 纯函数 + `index.js` mock 契约 + `--selftest` 内嵌矩阵 + 源码门禁（§17.1）；**单测不真派发** |
| "真派发一次"的用例 | **不加**（D3 选项 B 被否决：会弹 mstsc 窗口、无桌面环境会失败） |
| 状态栏移除的门禁 | **加**（§17.1 的 12 条 + 2 条 token 断言），照 webapp 先例；这是"删掉的功能必须留下防复活门禁"的既有做法 |

## 18. 文档同步

| 文件:行 | 改前 | 改后 |
| --- | --- | --- |
| `docs/spec/rdp-remote-desktop-design.md:119` | `open → … → 返回 {pid} 或错误` | `open → … → 返回 {pid:null, path, warnings} 或错误（cmd /c start 派发，见 §3.3 与 ADR-0003）` |
| `…design.md:130` | `launch … spawn('mstsc.exe',[rdpPath],{detached:true,stdio:'ignore'}).unref() → 返回 {pid}` | `launch … 解析 mstsc 绝对路径（%SystemRoot%\System32\mstsc.exe）→ buildStartArgs → spawn('cmd.exe',['/c','start','',mstsc,rdpPath],{windowsVerbatimArguments:false,detached:true,stdio:'ignore',windowsHide:true}) → 等 cmd 退出码 0 → 返回 {pid:null, path, warnings}` |
| `…design.md:235` | 状态栏示意 `最近：已打开 chenzhi@10.0.0.8:3389（mstsc pid 12345）` | **删掉该状态栏示意整行**，并把 ASCII 布局图的底部边界改到内容区（并注明"底部状态栏已于 1.0.3 移除，见 ADR-0003 与 README §14"） |
| `…design.md:243` | `- **底部状态栏**：一行文本记录**最近一次操作结果**…可点击折叠，默认展开。` | 改为 `- **无底部状态栏**（1.0.3 起移除）：操作结果与 `cmdkey` 告警只写控制台（`[rdp]` 前缀），见 README §14。` |
| `…design.md:266` | `…失败则回滚并在状态栏显示错误` | `…失败则回滚（错误原因写控制台；模态框内仍显示字段错误）` |
| `…design.md:271` | `…列表移除该卡 + 状态栏提示` | `…列表移除该卡 + 控制台日志` |
| `…design.md:288` | `字号：正文 13px、标题 15px/600、卡片标题 14px、状态栏 12px。` | 去掉"状态栏 12px"（状态栏已删） |
| `…design.md:292` | `Tab 顺序 = header → 卡片（打开/编辑/删除）→ 状态栏；` | `Tab 顺序 = header → 卡片（打开/编辑/删除）；`（并把 `role="status"` 相关描述随状态栏一起删） |
| `…design.md` §3.9.1 的布局图（`:224-237`） | 含 `statusbar 40px（可折叠）` 的框 | 删掉状态栏那一行与高度标注 |
| `…design.md:108` | 数据流图 `spawn mstsc.exe` | `cmd /c start "" mstsc.exe <rdp>`（保持一行长度） |
| `…design.md` §8 勘误表（`:344-353`） | — | **新增两行**：① `§3.2/§3.3` 的 `pid` 判据已被 1.0.3 取代 ⇒ 以 cmd 孤儿派发为准（指向 `docs/adr/0003`）；② `§3.9.1/§3.9.5` 的底部状态栏已整体移除、提示只写控制台（指向 README §14） |
| `docs/adr/0003-mstsc-orphan-launch-via-cmd.md`（**新增**） | — | 决策：为什么用 `cmd /c start`、否决 WMI/`explorer` 关联、成功判据换成退出码 0 的代价（含真机实证：`.rdp` 指向不存在的盘仍 exit 0）、`windowsVerbatimArguments` 的相反取值理由、`start` 挂住的真实形态与超时兜底、**状态栏移除与"提示只写控制台"的连带决定及可见性代价**、回退方案（见 §19.1） |
| `README.md:73` | `\| open \| { id } \| { pid, warnings }（pid = 拉起的 mstsc.exe）\|` | `\| open \| { id } \| { pid: null, path, warnings }（经 cmd /c start 孤儿派发，拿不到 pid，见 §14）\|` |
| `README.md:15-17`（目录结构） | `lib/cmdkeyArgs.mjs` 等三行 | 追加 `lib/mstscArgs.mjs  cmd 命令行构造（/c start 的参数数组 + 转义护栏 + mstsc 路径解析）` |
| `README.md:4`（首段能力描述） | `…→ 拉起 mstsc.exe。` | `…→ 经 cmd /c start 以**孤儿进程**拉起 mstsc.exe（不在 obox 进程树内）。` |
| `README.md` **新增 §14**（节号不冲突：现最大为 §13 `:329`，新节追加在文末，**不重排既有编号**）「启动方式与已知行为（为什么用 cmd / 提示只在控制台）」 | — | 内容见 §18.1 第 2 条（**必须包含**"告警在界面上不可见、要看请开 DevTools/看终端"这条已知行为） |
| `README.md:161-170`（已知限制） | — | 新增两条：① "已通过 shell 打开"只承诺**命令已派发**，不证明 mstsc 真的起来（真机实测：`.rdp` 指向不存在的盘时 `cmd` 仍 exit 0）；② 超长路径（>260）与 UNC 未验证 |
| `README.md:210`（勘误段） | `- **\`warnings\` 是会展示的**：界面把 \`open\`/\`remove\` 返回的 \`warnings\` 拼进状态栏，不是"留给后续"。` | 改为：`- **\`warnings\` 只进控制台（1.0.3 起）**：状态栏已整体移除，\`open\`/\`remove\` 的 \`warnings\` 与操作结果一律 \`console.info/error\`（前缀 \`[rdp]\`），**界面上不可见**——要看就开 DevTools 或看 obox 终端（见 §14「已知行为」）。` |
| `README.md:312`（搜索小节） | `…计数徽标与状态栏**仍是总数**；` | 改为 `…计数徽标**仍是总数**（状态栏已于 1.0.3 移除）；` |
| `README.md:79` | `界面当前只展示成功/失败，warnings 是留给界面后续展示的。` | 改为 `界面**不展示**任何提示（状态栏已移除）；warnings 与成败原因只进控制台（见 §14）。` |
| `README.md:166` | `**真实会话未验证**：验收止于"拉起 mstsc.exe"（进程起来即结束）` | 补一句：验收改为"**cmd 退出码 0 且 mstsc 进程出现**（随即结束）" |
| `README.md:199-202`（实测结论段） | `…launch 能写出 .rdp 并真的拉起 mstsc.exe…` | 追加 1.0.3 的实测结论（探针 P-1~P-6 摘要 + 本机 Windows build 26200 / mstsc 10.0.26100.8875） |
| `docs/spec/rdp-remote-desktop.md`（原始 spec） | `R-B7`/`R-B11` 写 `spawn mstsc.exe …（detached）` | **不改历史 spec**；在该文档已有的"勘误/后续待办"体例下追加一条指向 `docs/adr/0003`（它是阶段产物，不是活文档） |

### 18.1 "为什么用 cmd / 代价是什么 / 提示去哪看"该写在哪（**三处，各写各的粒度**）

1. **`extensions/rdp/docs/adr/0003-mstsc-orphan-launch-via-cmd.md`（权威决策）**：完整取舍——需求（不是 obox 的后代）、被否决的两条（WMI `Win32_Process.Create`、`explorer.exe <file>` 文件关联）、选定方案、代价（失去"真的起来了"的确认能力）、`windowsVerbatimArguments` 相反取值的理由、`start` 目标不存在会挂住的实测、超时兜底、**状态栏移除的连带决定与"告警界面不可见"的已知代价**、回退条件。**这是唯一权威处。**
2. **`README.md` 新增 §14「启动方式与已知行为」（面向使用者/维护者；现最大节号为 §13，新节追加在文末，不重排既有编号）**：必须写清四件事——
   - "obox 关掉/被杀后 mstsc 仍在"（结构性保证，附验收方法链接）；
   - "为什么绕一层 shell"（孤儿进程）与"`cmd` exit 0 ≠ 连上了"的**已知行为**（真机实证：`.rdp` 指向不存在的盘仍 exit 0）；
   - **"操作结果与告警（含凭据未保存）只在控制台，界面上不显示"**——给出查看方式（子窗口 `Ctrl+Shift+I` 开 DevTools，或看 obox 终端的 `[child-renderer:*]` 日志）与 grep 关键词 `[rdp]`；
   - "别把 `windowsVerbatimArguments` 改成 true"，并回指 §9 第 2 条（同一个选项在 cmdkey 那边必须取 `true` 的**相反**理由）。
   配一句"详细取舍见 `docs/adr/0003`"。
3. **`helper.cjs` 的 `launch` 注释 + `lib/mstscArgs.mjs` 的文件头 + `App.vue` 的 `setStatus` 注释（面向当场改代码的人）**：各 3–6 行，写"为什么是这 5 个参数"、"为什么 false 而 cmdkey 是 true"、"为什么拦 `%`"、"**为什么状态栏被删、这些调用点为什么保留（唯一诊断通道）**"。**`launch` 的注释里必须有一句指向 ADR-0003。**

> 设计文档（`docs/spec/rdp-remote-desktop-design.md`）只做**同步**（§18 表），不再重复论证——它已有 §8 勘误表的体例，本轮追加一行即可。

## 19. 风险与回退

| 风险 | 来源 | 可执行缓解 | 残余风险 / 接受人 |
| --- | --- | --- | --- |
| **R-1**："已打开"只表示命令已派发，mstsc 可能没起来（真机实测：路径指向不存在的盘时 `cmd` 仍 exit 0） | 阶段 1 R-1（用户已接受） | ① 文案诚实（"已通过 shell 打开"）；② mstsc 目标先 `existsSync`；③ `.rdp` 路径字符护栏；④ §16.2 ①② 真机确认"派发确实生效" | **接受**：无法再确认"真的连上了"；用户已在阶段 1 明确接受 |
| **R-2**：cmd 转义出错 ⇒ "看起来成功但实际没开"或路径被截断 | 阶段 1 R-2 | ① `buildStartArgs` 纯函数 + 表驱动测试（§17.2）；② `--selftest` 内嵌矩阵（§17.3）；③ `test/helper.test.js:99-108` 保留非法 fileName 断言；④ §16.2 ③ 真机替身验证；⑤ 本阶段探针已实测 11 类字符（P-1） | 低：函数**不做转义**（把责任交给 Node），护栏只拦不可安全传递的字符 |
| **R-3**：`start` 解析程序名受 `PATH`/`PATHEXT`/`App Paths` 影响（宿主只透传最小环境，无 `PATHEXT`） | 阶段 1 R-3；宿主 B23 | ① 用 `%SystemRoot%\System32\mstsc.exe` **绝对路径**；② 派发前 `existsSync`；③ 失败文案带完整路径（便于用户自己去看） | 低；若某机器的 mstsc 不在 `System32`（非默认安装/ARM），会明确报错而不是静默 |
| **R-4（新）**：`start` 目标解析失败时 `cmd` **挂住不退**（实测 ≥8s），若不加超时会留下僵尸 cmd 与永不返回的 IPC 调用 | 本阶段探针 P-6① | `START_TIMEOUT_MS = 15_000` + `kill()` + 明确报错 | 低；用户会看到一个错误，而不是一个转圈 |
| **R-5（新）**：`%VAR%` 被展开导致路径静默指向别处 | 本阶段探针 P-2 | `buildStartArgs` 拒绝含 `%` 的路径（实际上不可达，护栏成本 0） | 极低 |
| **R-6（新）**：后人把 `windowsVerbatimArguments` "统一"成 `true`（照着 cmdkey 抄） | 代码里两个相反取值 | ① 代码注释写明相反理由；② `README §9` 已有一条"相反取值"的既有说明，本轮补一条对照；③ 纯函数测试不覆盖 spawn 选项，故**必须在注释与文档里守** | 中：**这是本次改动最容易出的错**（见 §21 第 1 条） |
| **R-7（新）**：`ui/**` 忘记重新 build ⇒ `.oix` 里还是旧文案 | 打包流程 | §16.1 第 3、7 条（`npm run build` 先于 `pack`，并扫产物里不得再有 `statusbar`/`mstsc pid`）；`npm run release` 脚本已把 test+build+pack 串起来（`package.json:13`） | 低 |
| **R-8（v2 新）**：**删掉状态栏后，告警与失败原因在界面上彻底不可见** ⇒ 用户遇到"点打开没反应/卡片变红"时无从自查，支持成本上升 | 用户裁定（§0.2 P3 改判） | ① 控制台日志齐全且带 `[rdp]` 前缀（§11.2），子窗口日志经宿主转发到 obox 终端（不开 DevTools 也能看）；② README §14 写明"提示只在控制台"与查看方式；③ §16.2 ⑤ 把"日志必须能命中"列为**硬验收**（缺失即不通过）；④ 卡片状态点红色保留为唯一视觉兜底（待 §21 D4 定稿） | **用户已知情接受**（§0.3 D-1）；残余风险是"用户不看控制台"——这是本次裁定的直接代价，不做技术补救 |
| **R-9（v2 新）**：删状态栏时**只删了组件**、漏了 `styles.css` 的 `.statusbar*` 或 `theme.js` 的兜底 token ⇒ 留下死代码/无用 token，且下一个人会以为还有状态栏 | 代码面广（4 个文件 + 2 个测试） | ① §17.1 的 12 条源码门禁（含 `styles.css`、`StatusBar.vue` 必须不存在）；② §17.4 的 token 断言；③ §16.1 第 7 条扫编译产物；④ webapp 的既有门禁就是同款防复活做法（B30） | 低：门禁是**机器可判**的，漏了会直接红 |
| **R-10（v2 新）**：为了"删状态栏"顺手把 `HOST_THEME_TOKEN_NAMES`（宿主 25 项白名单）也改了 ⇒ `test/stylesTokens.test.js:134-137` 的"宿主 token 漂移即红"门禁失效 | 测试改动面 | §17.4 明确"宿主白名单保持 25 项不动，只改逐条相等那条"；§17.1 的注释再点一次 | 低 |

### 19.1 回退方案（若 cmd 机制在真机不可行）

> **注意（v2）**：状态栏移除与 cmd 派发是**两件可独立回退的事**。若真机验收①②失败需要回退 cmd 机制，**不要**顺手把状态栏装回来（那是另一条用户裁定）；反过来，若用户将来想恢复状态栏，也**不需要**动 cmd 派发。

**触发条件**（任一成立即考虑回退 cmd 机制）：① 真机验收 ① 显示 mstsc 仍挂在 obox 之下（说明 `start` 没派发到别的父进程）；② 某些目标机器 `cmd.exe` 被组策略禁用；③ 超时兜底频繁触发，用户可感知。

**回退动作（最小、可逆）**：

1. 把 `launch` 的 spawn 段改回 `spawn(resolveMstscPath(), [rdpPath], { detached:true, stdio:'ignore', windowsHide:true })`（**注意用绝对路径**，顺手把 R-3 的改进留下）；
2. `index.js` 的判据**回退为要求 pid**（`if (!pid) return fail(…)`）——旧代码可从 `bfd673c` 取回；
3. `App.vue`：只需把 `setStatus('ok', …)` 的文案改回带 pid 的版本（**不恢复状态栏**，仍走控制台；若用户同时要求恢复状态栏，那是另一次修订：从 `bfd673c` 取回 `StatusBar.vue` + `styles.css` 那 48 行 + `theme.js` 两个 token + §17.1 的门禁改成"必须存在"）；
4. 保留 `lib/mstscArgs.mjs` 与它的测试（不删；它们记录了一次被否决的尝试，且 `resolveMstscPath` 仍有用）；
5. 版本按"另一个补丁版"发（若 1.0.3 已发布，则发 1.0.4 回退；**不要**重写已发布的 tag）。

**回退需要重新决策的事**：① 是否引入 WMI/计划任务（用户在阶段 1 已否决，回退时要重新问）；② 是否接受"obox 退出会杀掉 mstsc"（若最终选择"进程树不重要、稳定性优先"）；③ 是否把"进程树独立性"降级为文档承诺而非结构保证（即明确写"obox 与 mstsc 无树杀关系，故不会被连带杀死"并把这条写进 README 的已知限制）。

## 21. 决策记录（v1 的待决策 → 已全部关闭；仅 D4 新开）

### 21.1 已关闭（用户逐条裁定；完整选项与权衡保留在下方折叠区，便于日后回看"当时为什么这么选"）

| 编号 | 议题 | 裁定 | 一句话理由 | 落地节 |
| --- | --- | --- | --- | --- |
| **P1** | cmd 转义 / `windowsVerbatimArguments` 策略 | **A**：`false`（Node 转义）+ 纯函数只拦 `%VAR%`/引号/换行 | 唯一被真机实测覆盖的选项（11 类字符原样到达，仅 `%VAR%` 被展开） | §6.1–§6.3 |
| **P2** | `.rdp` 文件是否保留 | **A**：保留（覆盖写、不自动清理） | 与现状/设计 §3.3 一致；"派发后删除"有真实的异步读文件时序风险 | §6.6 |
| **P3** | 状态栏文案 | **改判：整个状态栏删除**，提示只写控制台 | 用户要求与 `webapp` 扩展一致；"改文案"不如"删掉"彻底 | §0.2、§7.3、§10 |
| **D1** | `START_TIMEOUT_MS` | **A**：`15_000` | 实测正常 49–905ms ⇒ 16× 余量，且与 `CMDKEY_TIMEOUT_MS` 同风格 | §7.1 |
| **D2** | `launch` 返回形态 | **A**：保留 `{ pid: null, path, warnings }` | 与阶段 1 已关闭的 Q2 逐字一致，零契约破坏 | §7.1、§7.2 |
| **D3** | Testing seams | **A**：纯函数 + mock 契约 + `--selftest` 内嵌；单测不真派发 | 与仓库既有模式一致，且避免单测弹 mstsc 窗口 | §17.1–§17.6 |

<details>
<summary>各决策当时的 2–4 个选项与权衡（点开查看；这是历史记录，不是待办）</summary>

### P1｜转义 / verbatim 策略的最终取舍（阶段 1 P1）→ 已选 A

| # | 选项 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A（已采纳）** | **`windowsVerbatimArguments: false`（Node 转义）+ 纯函数只拦 `%VAR%`/引号/换行**，路径原样进数组 | 已真机实测 11 类字符全部原样到达（P-1）；不自己实现转义=不引入新 bug 面；拦 `%` 的成本 0 | 依赖 Node 的转义实现不变（Node 主版本升级需复跑一次真机探针） |
| B | `windowsVerbatimArguments: true` + 自己写一套 cmd 转义（引号加倍、`^` 转义 `%` 无解） | 完全可控、不依赖 Node | 必须自己实现 MSVCRT/cmd 双层规则；`%VAR%` 在 cmd 里**没有**可靠转义（只能靠拒绝或 `^` 的边角行为），风险显著高于 A |
| C | 不走 cmd：改用 WMI `Win32_Process.Create` 或在 `.rdp` 上做 `explorer` 文件关联 | 完全绕开命令行转义 | **用户在阶段 1 已明确否决**；WMI 需额外 COM/权限面，explorer 关联改变"用什么程序打开"的系统状态 |
| D | 其他（我来说明） | — | — |

### P2｜`.rdp` 文件是否保留（阶段 1 P2）→ 已选 A

| # | 选项 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A（已采纳）** | **保留**（与现状一致，每次打开覆盖写 `<id>.rdp`，不自动清理） | 现状已验证；便于排查（"到底写出去了什么"）；设计文档 §3.3 已如此写明（`:133`） | 会在 data 目录里积累与连接数同量级的小文件 |
| B | 派发成功后删除 | data 目录干净 | **删不掉**：`cmd /c start` 返回时 mstsc 可能还没读完文件（异步），删除会造成偶发"文件不存在"；且失败时反而更需要文件来排查 |
| C | 打开时写临时文件（`%TEMP%`）+ 退出时清理 | 不污染 data 目录 | `%TEMP%` 清理不可控、路径里会出现 `%`（与 P1 的护栏冲突）；诊断时找不到文件 |
| D | 其他（我来说明） | — | — |

### P3｜状态栏（阶段 1 P3）→ 用户改判为"整个删掉"

| # | 选项 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A | `已通过 shell 打开 <标题>（+warnings）· Windows 安全框…` | 诚实；"shell"呼应实现事实 | 普通用户可能不懂"shell" |
| B | `已派发打开命令：<标题>（+warnings）· …` | 更准确 | "派发"是工程词 |
| C | `已打开 <标题>（+warnings）· …`（只删 pid） | 改动最小 | 与 R-1 冲突：过度承诺 |
| **D（用户实际选的）** | **整条状态栏删除；所有提示只写控制台（`console.info`/`console.error`，前缀 `[rdp]`），与 `extensions/webapp` 一致** | 界面最干净；与另一个用户扩展同形态；诊断信息仍完整（控制台/终端） | **告警在界面上不可见**（§0.3 D-1，用户已知情接受）；原"看状态栏"的验收判据全部要改写（§0.3 D-2） |

### D1｜`START_TIMEOUT_MS` 取值 → 已选 A

| # | 选项 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A（已采纳）** | `15_000`（与既有 `CMDKEY_TIMEOUT_MS` 同量级同风格，`helper.cjs:28`） | 正常值 49–905ms，余量 16×+；与仓库既有超时常量风格统一 | 极端慢机器上可能误报 |
| B | `5_000` | 用户等待更短 | 换页/杀软扫描/首启冷缓存时（探针 8 已观测到 905ms）余量偏薄 |
| C | 不设超时 | 实现最简单 | `start` 目标不存在时会**永久挂住**（P-6① 实测 ≥8s 不退），IPC 调用直到宿主 60s 超时——用户看到 60s 无响应且没有解释 |
| D | 其他（我来说明） | — | — |

### D2｜`launch` 返回形态 → 已选 A

| # | 选项 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A（已采纳）** | 保留字段、值恒为 `null`：`{ pid: null, path, warnings }` | 与阶段 1 Q2 的形态**逐字一致**；测试改动最小（只改 mock 的值） | 保留一个恒为 null 的字段，读代码的人会问"它为什么在这"（用注释回答） |
| B | 删除 `pid`，只返回 `{ path, warnings }` | 契约最诚实：没有的东西不出现 | 与阶段 1 已关闭的 Q2 结论文字不一致（需回改需求结论）；`App.vue` 那行 `data.pid` 会拿到 `undefined` |
| C | 换个新字段 `dispatched: true` 替代 `pid` | 语义最清楚 | 又要动 UI、测试、README、设计文档四处；没有额外信息量 |

### D3｜Testing seams → 已选 A

| # | 选项 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A（已采纳）** | 纯函数测试（`lib/mstscArgs.mjs`）+ `index.js` mock 契约 + `--selftest` 内嵌矩阵 + 源码门禁；**不在单测里真派发** | 与仓库既有模式（`lib/*.mjs` + `node --test`）完全一致；不弹窗、可在 CI/无桌面环境跑 | "父进程已死"这条核心语义**不在自动化里**（必须人工验收 §16.2） |
| B | 额外在 `helper.test.js` 里真派发一次 mstsc 并断言 `pid === null` | 让回包形状也被自动化覆盖 | 单测会真的弹出 mstsc 窗口 ⇒ 污染开发者桌面、可能在无桌面环境失败（**唯一反对它的硬理由**） |
| C | 引入"可注入的 spawn"以便 mock 掉 `cmd.exe` | 可以不弹窗地测 spawn 分支 | 需要改 `launch` 的签名（新增注入口）；mock 掉的正好是"cmd 的真实语义"，测了也不代表真机对 |

</details>

### 21.2 新开（v2 唯一仍待用户点头的一条）

#### D4｜卡片自身的"失败红点 + 点开看错误原文"要不要一起删？（**新问题**，建议先裁再动代码）

**背景**：用户的原话是"**整个状态栏都不要**……所有提示改为只写控制台"。状态栏（`StatusBar.vue`）是独立的底部条，删它没有歧义。但卡片右上角还有一个**不属于状态栏**的失败反馈：状态点在失败时变红（`.dot--error`），**点它会在卡片内展开错误原文**（`src/App.vue:42-63,281-284,359-372`；`src/components/ConnectionCard.vue:39-54`）。它同样是一处"界面上的提示"，所以范围需要用户点头（当前**没有任何测试**断言它，B31 ⇒ 删或留都不会打断现有测试）。

| # | 选项 | 具体做法 | 优点 | 缺点 / 代价 |
| --- | --- | --- | --- | --- |
| **A（推荐）** | **保留状态点，删掉"点开看错误原文"** | 保留 `.dot--idle/opening/ok/error` 四态与 2s 绿→灰；去掉 `showError`、`toggleCardError`、`cardStates[].error` 的界面展示与 `ConnectionCard.vue:45-47,54` 的展开块；错误原文只进 `console.error` | 与"提示只写控制台"一致；用户仍能看到"这个连接刚才失败了"（视觉兜底不丢，也不违背"不要状态栏"）；改动小 | 用户看不到具体原因（要看原因得开 DevTools）——与 D-1 同一类代价 |
| B | **全删**（连状态点一起） | 卡片只留标题/副行/三按钮；`cardStates` 整个删掉 | 界面最干净、代码最少；与 webapp 的"零提示"最接近 | **打开失败将没有任何界面反馈**（用户点"打开"后可能完全不知道出错了）；也会失去"打开中"的禁用态与防重复点击能力（需要另想替代） |
| C | **全留**（状态点 + 展开错误原文） | 现状不动，只删底部状态栏 | 改动面最小；失败原因在界面上仍可查（可诊断性最好） | 严格讲仍留有"界面提示"，与用户"所有提示只写控制台"的字面要求不一致；需要用户明确接受这条例外 |
| D | 其他（我来说明） | — | — | — |

**推荐 A 的理由**：① 它精确执行"删状态栏 + 提示只写控制台"，同时**保住了唯一的失败视觉信号**——删掉状态栏已经让可见性很薄（§0.3 D-3、R-8），再把红点也删掉会让"打开失败"完全静默；② 状态点还是"打开中"防重复点击的载体（`ConnectionCard.vue:61` 的 `:disabled`），删它要连带设计替代方案，属另一件事；③ 选项 B 的代价（静默失败）与 R-1 的"误报"叠加后会变成"成功失败都看不出来"，明显更差。

**若选 A 的附带改动**（不影响其它节）：`App.vue` 删 `showError` 字段与 `toggleCardError` + 模板的 `@toggle-error`；`ConnectionCard.vue` 删 `showError` prop、`@click`/`:aria-expanded` 与 `card__error` 那段（`.card__error` 样式若只有它用则一起删，需在实现时 grep 确认）。**其余（状态点、`patchState`、2s 定时）保留。**

## 22. 实施时最容易出错的四个点

1. **`windowsVerbatimArguments` 被改成 `true`**（照抄 `runCmdkey`，`helper.cjs:85`）。后果：路径含空格时 `start` 只拿到半截路径，`cmd` 仍 `exit 0` ⇒ **静默走错**，且现有测试全绿（因为单测不启动真 cmd）。防线：代码注释 + 本规格 §6.2 + README §9 对照条 + §16.2 ③ 真机替身验证。
2. **把"删掉 pid 判据"理解成"删掉全部输入校验"**。后果：helper 回空值（通道没连上）时又变成静默成功，把 `index.js:158-162` 已有的告警白写了。防线：§7.2 的改后代码保留"reply 不是对象 ⇒ fail"分支；`extension.test.js` 对应的失败用例要**新增**一条（回 `null`/非对象 ⇒ `ok:false`）。
3. **`ui/**` 没重新 build 就打 `.oix`**（以及 `package-lock.json` 的 `:1294`/`:2405` 被顺手改成 1.0.3）。后果：① 装上去还是带 pid 的旧文案、真机验收 ④ 判据对不上；② 传递依赖版本被改坏，`npm ci` 直接报版本不一致。防线：§16.1 第 3、5 条；§11 的版本表已明确"只改 `:3` 与 `:9`"。
4. **（v2 新增）删状态栏时"删一半"**：典型三种半成品——① 删了 `StatusBar.vue` 与模板，但 `styles.css:411-457` 的 6 条规则或 `theme.js:41-42` 的两个 token 留着；② 把 `setStatus` 的**调用点**一起删了（那就同时丢掉唯一的诊断通道，D-1 的补偿手段直接作废；正确做法是**保留 8 处调用**、只把函数体改成写控制台，见 §7.3.3）；③ 为了改断言，顺手把 `stylesTokens.test.js` 的 `HOST_THEME_TOKEN_NAMES`（宿主 25 项白名单）也删了两项 ⇒ 宿主 token 漂移门禁失效。防线：§7.3.4 的删除清单逐项对照；§17.1 的 12 条门禁；§17.4 明确"白名单不动、只改逐条相等那条"；§16.1 第 7 条扫编译产物（**只扫 `ui/`，别动 `docs/evidence/**`**）。

---

## 23. 推荐实施顺序与文件所有权

| 步 | 独占文件 | 内容 | 依赖 |
| --- | --- | --- | --- |
| 1 | `lib/mstscArgs.mjs`（新） | `buildStartArgs` / `resolveMstscPath` + 文件头说明（为什么 false、为什么不能整串、为什么拦 `%`） | 无（P1 已定稿） |
| 2 | `test/mstscArgs.test.js`（新） | 参数数组形态 / 转义矩阵 / 拒绝矩阵 / `resolveMstscPath` / "永不自己加引号"护栏 | 步 1 |
| 3 | `helper.cjs` | 惰性 import + `START_TIMEOUT_MS = 15_000` + `launch` 重写 + `selftest` 内嵌矩阵 + 注释（指向 ADR-0003） | 步 1 |
| 4 | `index.js` | `open` 判据替换（§7.2）+ 卡片 version + `:57` 注释改"控制台" | 步 3（回包形状） |
| 5 | `test/extension.test.js`、`test/passwordBackfill.test.js` | §17.4 的逐行改法（pid mock 值、用例名、注释、断言消息） | 步 4 |
| 6a | `src/App.vue`、`src/components/StatusBar.vue`（删）、`src/styles.css`、`src/theme.js` | **状态栏移除 + `setStatus` 改只写控制台**（§7.3、§10） | 步 4（P3 已改判；**D4 建议先裁**，但其默认推荐 A 不阻塞 6a 的"删状态栏"部分） |
| 6b | `test/componentSource.test.js`、`test/stylesTokens.test.js` | §17.1 的 12 条源码门禁 + §17.4 的 token 断言与"逐条相等"改法 | 步 6a |
| 6c | `npm run build` | 重新产出 `ui/**`（**必须**，否则 `.oix` 里是旧界面） | 步 6a/6b |
| 7 | `docs/adr/0003-*.md`（新）、`docs/spec/rdp-remote-desktop-design.md`、`docs/spec/rdp-search-box.md`、`README.md` | §18 全部（含 README 新增 §14「启动方式与已知行为」） | 步 3–6c（要能引用最终实现） |
| 8 | `manifest.json`、`package.json`、`package-lock.json`（仅 `:3`/`:9`）、`index.js` 卡片 version | 版本 → 1.0.3（四处一致） | 步 1–7 |
| 9 | — | `npm test` → `npm run build` → `npm run pack` → 制品扫描（§16.1 第 7 条）→ §16.2 真机 ①–⑤ → `git tag v1.0.3` + release 附 `rdp-1.0.3.oix` | 全部 |

- **不需要生成 tickets**：改动集中在一个独立小仓库、一个垂直切片（helper → index → UI → 文档 → 版本），步 2/3 与步 7 可并行但无需为并行而拆卡。⇒ 本次**不建 `issues/`**。
- 顺序上的硬约束：① 步 1 必须早于步 3/4（契约先定）；② 步 6c（build）必须早于步 9（pack），否则包里是旧界面；③ 步 8 的版本必须在步 6c **之前**改好（`vite build` 不读版本，但 `pack.mjs` 读 `manifest.json`，而产物扫描要按 1.0.3 命名找）；④ 若 D4 裁定为 A/B（要动卡片错误展示），把对应改动并进步 6a，**不要**单独开步以免与 6b 的门禁交叉。
- 可并行边界：步 7（文档）与步 6a–6c（界面）文件不重叠，可并行；步 6c 的 build 必须串在 6a/6b 之后。

## 24. 未核实项（禁止当作已确认）

| # | 未核实的事 | 查法 |
| --- | --- | --- |
| U1 | **真的 mstsc**（而非 notepad 替身）经 `cmd /c start` 派发后，父进程确实是一条已退出的 cmd | §16.2 ①：`Get-CimInstance Win32_Process -Filter "Name='mstsc.exe'"` 看 `ParentProcessId`，再用 `Get-Process -Id <ppid>` 确认查不到 |
| U2 | 关闭/强杀 obox 后 mstsc 仍在（真机） | §16.2 ② |
| U3 | `mstsc.exe` 单实例行为（已在运行时再 `start` 一次，是复用窗口还是报错）| 开两个连接分别点开，看是否只有一个窗口；`Get-CimInstance … mstsc.exe` 的进程数 |
| U4 | 应用 manifest 里 `helper.cjs` 的 cwd **安装态**是 `<userData>/extensions/rdp_chenzhi/data`，从而路径里到底有没有怪字符 | 打开扩展后看 helper 的 stderr（`[rdp-helper] 就绪 cwd=…`），或临时在 UI 点「环境检查」（`probe` 返回 `cwd`） |
| U5 | 超长路径（>260）与 UNC 路径下 mstsc 的行为 | 造一个超长 `<data>` 或把 `.rdp` 放 UNC，跑 §16.2 ①③ |
| U6 | 某些企业策略下 `cmd.exe` 是否被禁用（阶段 1 异常场景 1） | 在目标机器上直接 `cmd /c echo ok`；若禁用，走 §19.1 回退 |
| U7 | 宿主在**安装态**下 `minimalEnv` 是否真的没有 `PATHEXT`（读代码是 B23，未在运行期打印验证） | 在 helper 里临时 `console.error(JSON.stringify(process.env))` 一次，或看 `probe` 扩展后的返回 |
| **U8（v2 新增）** | 子窗口的 `console.info/error` 在**安装态**下到底出现在哪里（DevTools 一定能看到；"经主进程转发到 obox 终端"这条是从 `webapp` 的注释（`webapp/src/App.vue:96-98`）与宿主既有行为推断的，**本阶段未实测**） | 安装态打开扩展 → 打开一张卡 → 在 obox 终端里找 `[child-renderer:*]` 与 `[rdp]`；找不到则在 DevTools 里确认（DevTools 是**保底**通道，README §14 的措辞应以实测为准） |
| **U9（v2 新增）** | 删掉状态栏后 `.app__content` 是否确实自动多出 40px（推断依据是 `styles.css:87-92,132-135` 的 flex 布局，未真机量过） | 改完后在 1024×720 子窗口截图对比"最后一行卡片是否被裁"；必要时只调 `.app__content` 的 padding，**不要**恢复固定高 footer |

## 25. 勘误（对阶段 1 需求结论的两处修正；**不回改 requirements.md**）

> 用户已确认采纳这两条勘误，并明确**不要在 `.spec-workflow/rdp-mstsc-detach/requirements.md` 上改**（那是阶段 1 的历史记录）。因此**更正只写在本规格**：凡读到 requirements 里那两处旧表述，以本节为准。

1. **requirements 里的 `src/main/pythonRun.ts:194`（树杀位置）写错了**：`pythonRun.ts` 只有 128 行，`/T` 树杀的实际实现在 `src/main/pythonCore.ts:194`（`return { program: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] }`）；`pythonRun.ts:8,114` 只是注释与"退回单进程 kill"的说明。**结论不变**（宿主里唯一的树杀只服务 python 运行器）。**已更正**，见 §5.2 B22。
2. **requirements 记载的本机 Windows build `26200.9457` 与实测不一致**：本阶段实测 `Win32_OperatingSystem.BuildNumber = 26200`、`Caption = Microsoft Windows 11 专业版`（`.9457` 只出现在 `mstsc` 的文件版本 `10.0.26100.8875` 的语境里，不是 OS build）。写文档时以"**Windows 11 build 26200**"为准。**已更正**，见 §5.3 表头。

## 26. 交接给 `spec-do` 的输入清单

- 权威输入：本文件（`spec.md` / `spec@v2`，含 §0 修订记录）；阶段 1 `.spec-workflow/rdp-mstsc-detach/requirements.md`（历史记录，两处勘误以 §25 为准）。
- **前置闸门：已全部关闭**（§21.1 六条 = 用户裁定；§21.2 D4 = **唯一新开项**，建议先取一次用户意见再动卡片错误展示；D4 若不动，规格其余部分**无阻塞**）。
- 实现目标仓库：`extensions/rdp`（**独立仓库**，直接在 `master` 上 commit；**不要**在 obox 仓库里提交任何东西）。
- 验收主命令：`cd extensions/rdp && npm test && npm run build && npm run pack` + §16.1 第 7 条的制品扫描 + §16.2 人工清单 ①–⑤。
- **实现报告必须覆盖的三个新点**：① 状态栏四件套（`App.vue` / `StatusBar.vue` / `styles.css` / `theme.js`）逐项落地并有门禁；② 控制台日志按 §11.2 的表逐条可见（§16.2 ⑤）；③ 未核实项（U1–U9）**不得**写成"已验证"。

---

## 27. 本规格最终输出摘要

- **规格版本**：`rdp-mstsc-detach/spec@v2`（739 行 → 本版约 1000+ 行，新增 §0 修订记录；节号 20 之后整体 +1）。
- **Goal Mode**：**disabled**（每版单独授权；用户本次未授权自动驾驶，理由见 §1）。**不阻塞实现**。
- **决策状态**：§21.1 六条**已关闭**（P1=A、P2=A、P3=改判"删状态栏"、D1=A、D2=A、D3=A）；§21.2 **D4 新开**（卡片红点/错误原文是否一起删，推荐 A：留红点、删"点开看原文"）。
- **ticket 指引**：**未生成**（§23 已说明理由：单一垂直切片，无需拆卡）。
- **写入的产物**：`.spec-workflow/rdp-mstsc-detach/spec.md`（本文件，**唯一**被改的文件）。
- **未写入**：`issues/`（不需要）、`amendments/`（修订记录内联在 §0）、`research/`（无额外研究笔记）、`requirements.md`（用户明确要求不改）。
- **推荐实施顺序**：§23 步 1 → 2 → 3 → 4 → 5 → 6a → 6b → 6c → 7 → 8 → 9。
- **当前前沿（可立即开工）**：**§23 步 1（`lib/mstscArgs.mjs`）** —— 前置闸门已关闭，**可直接进入 `spec-do`，无阻塞**（唯一建议先问的是 D4，它只影响 §23 步 6a 里"卡片错误展示"那一小块，不影响其余 8 步）。
- **下一步建议**：主代理把 §21.2 **D4** 单独转问用户（一次一问、带选项）；得到答复后直接在实现里落地，**无需**再修订本规格（D4 的三个选项及后果已在本文件写明，选 A/B/C 都不会改变其它节）。
