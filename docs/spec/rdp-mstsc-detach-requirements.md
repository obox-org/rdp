> **归档注记**：本文件是需求「rdp 扩展——mstsc 以孤儿进程启动（脱离 obox 进程树）」的 **阶段 1（需求研究结论，`to-grill`）产物**，
> 由 obox 仓库 `.spec-workflow/rdp-mstsc-detach/requirements.md` 于 2026-10-13 复制归档，属历史记录，正文按原文保留、不回改。
>
> 实现已随 **rdp v1.0.3** 发布；决策记录见 `docs/adr/0003-mstsc-orphan-launch-via-cmd.md`，方法契约以 `README.md` 与代码为准。
>
> 文中若出现 obox 仓库旧路径（`skills/obox-ext-dev/references/*`），已在 **obox v1.0.8** 迁到 `docs/extension-api/`。

# 需求研究结论：rdp 扩展——mstsc 以孤儿进程启动（脱离 obox 进程树）

- 需求来源：用户指令「rdp扩展，在打开mstsc后，mstsc进程应该和obox或者扩展进程独立，而不是作为obox的后代进程」
- 流程：to-grill（阶段 1）｜日期：2026-10-13
- Git 入口（流程产物落位 = obox 仓库，未跟踪，不动 master）：
  - obox：分支 `master`，HEAD `cc506f1`，porcelain **0 行**（干净）
  - 目标仓库 `extensions/rdp`：分支 `master`，HEAD `bfd673c`，最近 tag `v1.0.2`，porcelain **0 行**
  - 分支决策：**A（用户选）**——产物写在 obox `.spec-workflow/`（未跟踪）；扩展改动直接在 `extensions/rdp` 的 **master** 上做（该仓库无 PR 保护/CI，发布流程本就是 commit → tag → release）；完成后发补丁版 **rdp 1.0.3** + `rdp-1.0.3.oix`

## 背景（已核实的事实）

| 事实 | 位置 |
| --- | --- |
| 助手当前用 `spawn('mstsc.exe', [rdpPath], { detached: true, stdio: 'ignore' })` + `child.unref()` | `extensions/rdp/helper.cjs:178,183` |
| 宿主结束 IPC 助手时**只杀直接子进程**（`child.kill()`），**不是** `taskkill /T` 进程树 | `src/main/ipcTransport.ts:123`（宿主里唯一的 `/T` 树杀只用于 python 运行器 `src/main/pythonRun.ts:194`） |
| ⇒ mstsc **多半不会**被 obox 连带杀死，但其 **PPID 仍是助手进程** → 在任务管理器/Process Explorer 的进程树里**挂在 obox 之下** | 上述两点推论 |
| `pid` 在扩展里**承载语义**：`index.js:317-330` 明确"没有 pid 就是没拉起 mstsc，不能再静默当成功"；UI 显示"（mstsc pid N）"；spec/README/测试均按 `{pid}` 写 | `helper.cjs:162,179-184`、`index.js:317-330`、`src/App.vue:227-231`、`docs/spec/rdp-remote-desktop-design.md:119,130,235`、`README.md:73`、`test/extension.test.js:297,304` |

## 目标

让 **mstsc.exe 不是 obox/助手进程的后代**：进程树里不带 obox 祖先，obox 退出或被杀都不影响已打开的 mstsc 会话。

## 非目标

- 不做进程跟踪/管理（不提供"关闭会话"按钮，不改现有"打开"语义的其它部分）。
- 不改变 `.rdp` 文件生成位置与凭据预置（`cmdkey`）逻辑。
- 不引入 WMI/计划任务等更重的启动通道（用户已否决）。
- 不要求跨平台（rdp 扩展仅 Windows）。

## 用户流程

不变：卡片列表 →「打开」→ 生成 `<扩展 data>/rdp/<id>.rdp` →（按需）`cmdkey` 预置凭据 → **经 `cmd /c start` 拉起 mstsc** → 状态栏提示"已打开 <标题>（已通过 shell 打开）"，并保留"Windows 安全框里本地资源默认全不勾"的提示。

## 功能范围

- **R1 启动方式**：助手改为 `spawn('cmd.exe', ['/c', 'start', '', 'mstsc.exe', '<rdpPath>'], ...)`（`start` 后的空 `""` 是窗口标题占位，必须保留；`<rdpPath>` 为**绝对路径**）。
- **R2 进程独立性**：`cmd` 立即退出 ⇒ mstsc 的父进程成为已死进程，进程树里**不再挂在 obox 之下**；obox 退出/被杀不影响 mstsc（需真机验证）。
- **R3 成功判据（用户已选 B）**：以 **`cmd` 退出码 0 = 成功**；`launch` 返回 `{ pid: null, path, warnings }`；**删除**"无 pid 即失败"的规则。
- **R4 界面**：状态栏文案去掉 pid，改为"已通过 shell 打开"（保留 warnings 与安全框提示）。
- **R5 文档同步**：spec 的方法表/设计段、`README.md` 的方法表、`test/extension.test.js` 与 `test/passwordBackfill.test.js` 的 `{pid}` 断言、`docs/` 内的相关描述一并更新。
- **R6 助手自检**：`--selftest` 不真启动（现状保持），但新增对**cmd 命令行构造**的纯函数单测（引号/空格/中文路径/`%` 变量等转义用例）。

## 业务规则

- `start` 必须带空标题占位（否则含引号的路径会被当作窗口标题）。
- 传给 cmd 的路径必须按 **cmd 规则**转义（沿用同仓库 `quoteForCmdkey` 的经验；`windowsVerbatimArguments` 与引号策略需在实现时确认并测试）。
- 失败（`cmd` 退出码非 0，或 spawn error）仍要**明确报错**，不得静默当成功。

## 权限、安全与审计

- 不变：不新增任何宿主 API、不扩大文件访问面；`.rdp` 仍写在扩展 data 目录；凭据仍走 `cmdkey` 且不落日志。
- 新增面：**执行 `cmd.exe`**（系统自带）——需在文档里说明这是刻意的（为了孤儿进程），并保证参数不来自未校验的自由文本（路径由助手自己生成）。

## 异常与边界场景

1. `cmd.exe` 不存在/被策略禁用 → 明确报错（不回退旧方式，避免行为不一致）。
2. 路径含空格/中文/`&`/`^`/`%` → 转义测试须覆盖；`%` 在 cmd 中可能被当作变量 → 需验证。
3. mstsc 因系统策略/关联被禁 → `cmd` 退出码可能仍为 0（`start` 已派发）⇒ **接受**：这是用户选定语义（方案 B）的已知代价，界面只承诺"已派发"。
4. 同一 `.rdp` 重复打开 → 与现状一致（mstsc 自行处理多窗口/复用）。

## 风险

- **R-1（用户已接受）**：去掉 pid 判据后，"已打开"只表示**命令已派发**，无法再确认 mstsc 真的起来了（原判据是真机教训换来的）。
- **R-2**：`cmd` 转义若出错，可能出现"看起来成功但实际没开"或路径被截断；必须用纯函数单测 + 真机验证共同兜住。
- **R-3**：`start` 的行为可能受 `PATHEXT`/`App Paths`/环境变量影响（相对调用 `mstsc.exe`）；实现时优先用系统绝对路径或在文档中记录前提。

## 已关闭问题

| # | 问题 | 结论 |
| --- | --- | --- |
| Q1 | 用什么机制脱离 | **B：`cmd /c start` 启孤儿进程** |
| Q2 | 没 PID 后成功判据 | **B：不再要求 PID**（`cmd` 退出码 0 即成功；`launch` 返回 `pid: null`；UI/文档/测试同步改） |
| Q3 | 分支与产物落位 | **A**（产物在 obox 未跟踪；扩展在自己 master 上做，发 rdp 1.0.3） |

## 显式延后 / 待确认（spec 阶段定稿，均给推荐默认值）

- **P1**：`cmd` 具体转义策略与 `windowsVerbatimArguments` 取值（实现时以真机试验为准，需在 spec 写明测试矩阵）。
- **P2**：是否保留 `.rdp` 文件（现状保留；spec 需说明 mstsc 读取后文件可留可删）。
- **P3**：状态栏文案最终措辞（推荐"已通过 shell 打开"）。

## 建议下一步

进入 `to-spec`：产出实现规格（cmd 命令行构造与转义矩阵、返回值契约变更、UI/文档/测试改动清单、真机验收步骤：进程树无 obox 祖先 + 关闭 obox 后 mstsc 仍在）。
