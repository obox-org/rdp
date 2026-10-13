# mstsc 经 `cmd /c start` 以孤儿进程启动（以及随之移除的界面状态提示）

- 日期：2026-10-13
- 前置：`docs/adr/0001`（起进程走 `api.ipc` + `helper.cjs`）、`docs/adr/0002`（主题桥与兜底 token）
- 权威来源：`.spec-workflow/rdp-mstsc-detach/spec.md`（`rdp-mstsc-detach/spec@v2`，含 §5.3 的真机探针 P-1~P-8）

## 背景

1. **现状把 mstsc 挂在 obox 之下**：`launch` 直接 `spawn('mstsc.exe', [rdpPath], { detached: true })`，
   于是任务管理器里能看到 `obox.exe → 助手 node → mstsc.exe`。用户的心理模型是"我只是打开了系统远程桌面"。
2. **"obox 关了会不会带走 mstsc"说不清**：宿主结束 IPC 助手时只 `child.kill()` **直接子进程**
   （`src/main/ipcTransport.ts:120-124`，不做树杀；宿主里唯一的 `/T` 树杀只服务 python 运行器
   `src/main/pythonCore.ts:194`）。所以现状**多半**不会被连带杀死——但这是"实现细节决定的侥幸"，
   不是"结构上不可能"。
3. **"确认真的起来了"与"不是 obox 的后代"在旧实现里互斥**：旧的成功判据是"拿到 mstsc 的 pid"
   （`index.js` 的 `if (!pid) fail(…)`），而 pid 只有在 mstsc 是助手**直接子进程**时才拿得到。
4. **用户另有一条要求**：界面不要底部状态栏（与另一个用户扩展 `extensions/webapp` 同形态），
   所有结果与告警只写控制台；随后进一步裁定：**卡片右上角的失败状态点与"点开看错误原文"也一起删**。

## 决策

### 1. 用 `cmd.exe /c start` 派发（而不是 WMI / explorer 关联）

```js
spawn('cmd.exe', buildStartArgs(resolveMstscPath(), rdpPath), {
  windowsVerbatimArguments: false, // 见决策 3
  detached: true,
  stdio: 'ignore',
  windowsHide: true
})
// 参数数组：['/c', 'start', '', <mstsc 绝对路径>, <.rdp 绝对路径>]
```

`cmd` 派发后自己退出（真机实测 **49–905ms**，正常路径 ~60ms），mstsc 的父进程随之变成**一条已断开的链**。
**成功判据 = `cmd` 退出码 0**；`launch` 返回 `{ pid: null, path, warnings }`（字段名保留、值恒为 `null`，
只是为了不改既有契约）。

**被否决的两条**：

| 方案                                    | 为什么不用                                                                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WMI `Win32_Process.Create`              | 要引入 COM/WMI 调用面与权限假设（远程/本地策略、`WbemScripting` 依赖），收益只是"父进程是 WmiPrvSE"——与 `start` 一样不是真正的"孤儿"，但复杂度高一个量级。用户在阶段 1 已明确否决。 |
| `explorer.exe <file.rdp>`（走文件关联） | 副作用是**改系统状态**：用什么程序打开 `.rdp` 变成关联查询的结果，用户装了别的 RDP 客户端（msrdc/Windows App）时行为跟着变；且 `explorer` 的参数解析与 `start` 一样有引号坑。       |

### 2. `start` 前先校验 mstsc 存在（把"挂住"前移成"明确报错"）

**真机形态**（探针 P-6）：`start` 的**目标程序名解析失败**时，它会弹"选择打开方式"对话框并
**挂住 `cmd` 不退出**（实测 ≥8s 不退）；而 `.rdp` 路径指向**不存在的盘**时 `cmd` 仍 **exit 0**
（由 mstsc 自己弹框报错）。

因此：① `existsSync(resolveMstscPath())` 失败即在毫秒级抛
`未找到 mstsc.exe（远程桌面客户端）：<路径>`，**不写 `.rdp`**；② 仍保留
`START_TIMEOUT_MS = 15_000` 兜底（超时先 `kill()` 再抛错，不留僵尸 `cmd`）。

### 3. 目标用**绝对路径**，`windowsVerbatimArguments` 取 **`false`**（与同仓库 `runCmdkey` 的 `true` 相反）

- **绝对路径**：`start` 解析程序名依赖 `PATH` + `App Paths` + `PATHEXT`，而宿主给助手的**最小环境**
  里没有 `PATHEXT`（`src/main/ipcTransport.ts:27-35`）。写成 `%SystemRoot%\System32\mstsc.exe` 把这几个
  变量从等式里拿掉。
- **`false` 是故意的，且与 `runCmdkey` 的 `true` 相反**：
  - `cmdkey` 用的是**它自己的土解析器**，所以那一边必须旁路 Node 的转义（`helper.cjs` 的 `runCmdkey`、README §9 第 2 条）；
  - `cmd.exe` 用的是**标准命令行解析器**，Node 在 `false` 下的转义（含空白的参数整体加引号）正是我们要的。
  - 改成 `true` 的后果：路径含空格时 `start` 只拿到半截 token，`cmd` **仍然 exit 0** ⇒ **静默走错**，
    而且现有单测全绿（单测不启动真 cmd）。**这是本次改动最容易出的错**，所以代码里写死取值并加注释。
- 真机实测（探针 P-1/P-2/P-3）支持这个选择：`空格`、中文、`&`、`^`、`(`、`)`、`!`、不配对的 `%`、
  `|`、`<`、`>` **全部原样到达**目标进程；只有 `%VAR%` 会被展开（路径被静默改写到别的目录）。
  因此 `buildStartArgs` 只拦 `%VAR%` / 双引号 / 换行，**不做任何引号或转义**（转义是 Node 的事）。
- ⚠️ **与规格 §6.1 示例代码的一处刻意偏离**：§6.1 的示例写的是 `if (file.includes('%')) throw …`
  （拦任何 `%`），而 §6.3 的字符表与 §17.2/§17.3 的测试矩阵要求"不配对的单个 `%`（`100% done`）
  原样通过、只拦 `%VAR%`"。三处不能同时成立，本实现按 **§6.3 + §17** 落地（判据 = 存在一对 `%…%`）。
  真实可达路径只有 `<扩展 data 目录>/rdp/<正整数 id>.rdp`（用户名是唯一可能含怪字符的成分），
  两种口径在这个集合上都不会误派发——差别只在"用户名里恰好有一个 `%`"时是报错还是正常打开。

### 4. 成功判据换成退出码 0 的**代价**（用户已知情接受）

- `cmd` 退出码 0 只证明"命令已派发"，**不证明 mstsc 真的起来了**：真机实测把 `.rdp` 指向不存在的盘
  （`Z:\definitely\missing\dir\x.rdp`）时 `cmd` **仍然 exit 0**。
- 补偿：① 文案只承诺"**已通过 shell 打开**"，绝不写"已连接/已打开会话"；② mstsc 目标先 `existsSync`；
  ③ `.rdp` 路径字符护栏；④ README §14「已知行为」写明这条；⑤ 真机验收用进程树确认派发生效。
- 不再有"界面里的假成功"：失败只进控制台（`console.error('[rdp] …')`），成功进 `console.info`。

### 5. 连带决定：删除界面状态提示（状态栏 + 卡片状态点），提示只写控制台

| 删掉的东西                                                                                            | 替代                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/StatusBar.vue`（整个底部状态栏）                                                      | 8 处 `setStatus(kind, text)` **调用点全部保留**，函数体改成 `console.info/error('[rdp] ' + text)`——它是**唯一的诊断通道**（子窗口日志经宿主转发到终端，前缀 `[child-renderer:*]`） |
| `styles.css` 的 `.statusbar*` 6 条规则、共享焦点规则里的 `.statusbar__toggle:focus-visible`           | 无（`.app__content` 是 `flex: 1 1 auto`，footer 消失后自动长高，布局不用改）                                                                                                       |
| `theme.js` 兜底表里的 `--statusbar-bg` / `--statusbar-fg`                                             | 无。兜底表口径改为"**只放界面真会消费的 token**"（先例 `extensions/webapp/src/theme.js`），宿主白名单仍 25 项、门禁改为**子集**断言                                                |
| 卡片右上角状态点（灰/蓝/绿/红 + 脉冲）与"点开看错误原文"展开区、`cardStates`/`patchState`/`showError` | **静默去重**：同一卡片 **1 秒内**的重复点击**直接忽略**（`src/dedup.js`），界面不出现任何变化（不加禁用态、不加文案、不写日志）                                                    |

**已知代价（明写）**：

1. **告警在界面上完全不可见**：`warnings`（如「凭据可能未保存（TERMSRV/h）」）与失败原因只在控制台。
   用户不开 DevTools 时，正常路径下**看不到任何提示**（连"卡片变红"都没有了）。排查方式是 README §14
   写明的"开子窗口 DevTools 或看 obox 终端里 `[rdp]` 前缀的日志"。
2. **`role="status"` 无障碍播报点随状态栏消失**，控制台日志不被屏幕阅读器播报。
3. **去重窗口是固定 1 秒、不跟随 IPC 时长**：`open` 慢于 1 秒（例如 cmdkey 卡住）时第二次点击会被放行，
   仍可能开出两个窗口；失败后 1 秒内的重试也会被静默吞掉。要更严需改成"在飞请求未回前一律忽略"，
   那要引入可见/不可见的状态，与"不加禁用态"的裁定相冲，故不做（详见 `src/dedup.js` 文件头）。

## 后果

- **好处**：mstsc **结构上**不在 obox 进程树内（父进程是一条已退出的 `cmd`）——obox 正常退出或被强杀都不影响它；
  成功判据不再要求"mstsc 是我们的子进程"，`launch` 的契约也不再随进程关系漂移；界面只剩卡片与三个按钮。
- **代价**：多一次进程创建 + 一次退出等待（真机 49–905ms，用户可感知差异 ~0.1s）；失去"确认 mstsc 真的起来了"
  的能力（决策 4）；告警可见性下降（决策 5.1）；多一层 `cmd` 解析 ⇒ 转义错误的后果是**静默**的（决策 3）。
- **防线**：`lib/mstscArgs.mjs` 的纯函数矩阵（`test/mstscArgs.test.js` + `helper.cjs --selftest` 内嵌矩阵）、
  `index.js` 的"回包不是对象 ⇒ 失败"（真实故障=通道没连上）、`test/componentSource.test.js` 的源码门禁
  （禁止 `StatusBar`/`statusText`/`statusKind`/`statusCollapsed`/`statusbar`/`mstsc pid` 复活，
  禁止状态点与"打开中"禁用态复活、要求静默去重存在）、`test/stylesTokens.test.js` 的"兜底表不得留
  `--statusbar-*`"、以及打包产物扫描（`ui/assets/*` 里不得出现 `statusbar` / `mstsc pid`）。
- **未核实**（**不得**当作已验证）：真的 mstsc（而非 notepad 替身）经 `start` 派发后的父进程关系、
  关掉 obox 后 mstsc 仍在、`mstsc` 单实例行为、超长路径/UNC、企业策略禁 `cmd` —— 见规格 §24 U1–U9，
  只有 §16.2 的人工验收能关闭它们。

## 回退方案（若真机验收 ①/② 失败）

**触发条件**（任一成立）：① 真机验收显示 mstsc 仍挂在 obox 之下；② 某些机器 `cmd.exe` 被组策略禁用；
③ 15s 超时频繁触发、用户可感知。

**回退动作（最小、可逆）**：

1. `launch` 的 spawn 段改回 `spawn(resolveMstscPath(), [rdpPath], { detached: true, stdio: 'ignore', windowsHide: true })`
   （**保留绝对路径**这个改进），删除 `startViaCmd`；
2. `index.js` 的判据回退为要求 pid（旧代码可从 `bfd673c` 取回）；
3. `App.vue` 只把 `setStatus('ok', …)` 的文案改回带 pid 的版本——**不要把状态栏装回来**（那是另一条用户裁定，
   要恢复得从 `bfd673c` 取回 `StatusBar.vue` + `styles.css` 那 48 行 + `theme.js` 两个 token，
   并把 §17.1 的门禁从"不得存在"改成"必须存在"）；
4. **保留** `lib/mstscArgs.mjs` 与它的测试（记录了一次被否决的尝试，且 `resolveMstscPath` 仍有用）；
5. 版本按"另一个补丁版"发（1.0.3 已发布则发 1.0.4，**不重写已发布的 tag**）。

**回退时需要重新决策的事**：是否引入 WMI/计划任务（阶段 1 已否决）；是否接受"obox 退出会杀掉 mstsc"
（若改为"稳定性优先"）；或把"进程树独立"降级为**文档承诺**而非结构保证（写进 README 已知限制）。
