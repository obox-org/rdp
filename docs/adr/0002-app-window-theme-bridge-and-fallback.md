# 子窗口主题接收桥（`obox-theme`）与内置兜底配色

## 背景

1. **`url` 型 App 卡片拿不到主题 token**。RDP 子窗口加载的是 `app://extensions|debug/<id>/ui/index.html`，与父文档（dev 的 `http://localhost:5173` / 打包的 `file://`）**跨源**：
   - CSS 自定义属性**不跨文档继承**；
   - `iframe.contentDocument` 恒为 `null` ⇒ 宿主注入不了 `<style>`；
   - 扩展在子窗口里**没有 `api` object**（`bridge.js` 也是靠 `postMessage` 走宿主消息桥）。
     ⇒ token **只能经消息送达**。
2. **宿主自 2026-10 起对 `url` 型卡片单向推送 token**（宿主侧决策见仓库 `docs/adr/0022-url-app-window-theme-token-delivery.md`）：
   `{source:'obox-app', action:'obox-theme', themeId, tokens}`，`tokens` 是 **`getComputedStyle(documentElement)` 的生效值快照**（25 个白名单 token），触发点是 iframe `load`、主窗口主题变化、以及子页面的 `obox-theme-request`。
   这一步也顺带修掉了宿主既有缺陷：子窗口是独立 document，主窗口切主题时原本**没有任何**跨窗口通知。
3. **首帧早于任何推送**：`<script type="module">` 会先执行完才轮到父页面回包，所以"等推送到了再上色"在物理上做不到——页面会先闪一下 UA 默认色（深色背景下白底黑字）。
4. **R-D1 的硬约束**：`styles.css` **零色彩/字体族字面量**（`test/stylesTokens.test.js` 门禁），所以兜底值不能写进 CSS，只能集中在 JS 常量里。

## 决策

1. **新增 `src/theme.js` = 主题接收桥**：`FALLBACK_TOKENS`（宿主 dark 的 25 个 token 副本）+ `applyThemeTokens` + `installThemeBridge`。协议字面量与设计 §2.7.2 逐字一致（`SOURCE='obox-app'` / `action:'obox-theme'` / `'obox-theme-request'`）。
2. **`main.js` 在 `createApp().mount()` 之前调用 `installThemeBridge()`**：它**同步**把兜底 token 逐个 `documentElement.style.setProperty` 写下去（首帧就有配色），随后再异步接收宿主推送并覆盖。
3. **请求重发 0 / 300 / 1000 ms 三次**（`requestDelaysMs`）：只为覆盖"父页面 `load` 早于子页面监听器就绪"这类时序；收到任意一次推送即 `cancelPending()` 停发，三次都没响应则 `console.warn` 一次（不抛错）。请求不带 `requestId`——它是**通知 + 重发**，不是请求-响应，因此不复用 `bridge.js`。
4. **`styles.css` 只写裸 `var(--token)`**（不写 `, fallback` 字面量，否则又变成自造色值）——兜底值只存在于上面那一处 JS 常量。
5. **非法输入一律丢弃、不抛错**：token 名不匹配 `^--[a-z0-9-]+$`、非字符串、空值（扩展侧比宿主更严：**纯空白也算空**，因为 `var()` 会把它求值成空 ⇒ 文字/底色消失）都被丢掉，汇总成一条 warn；任何异常只 `console.warn('[rdp] …')`，主题拿不到**不该让页面挂掉**。
6. **`color-scheme` 由 `colorSchemeForThemeId(themeId)` 决定**（id 含 `light` → `light`，其余 → `dark`）：只影响 UA 绘制的原生控件/滚动条底色，不参与任何自绘配色（扩展**不得**把 `themeId` 当色值用）。
7. **`bridge.js` 不改**：请求-响应桥（`obox-extension(-reply)`，经主进程 IPC、有 `requestId`）与主题单向推送职责分开。

## 后果

- **好处**：`url` 型卡片与宿主主题一致（含第三方主题），扩展侧**零 token 值依赖**；拿不到推送时也**不空白、不报错**（内置兜底）；`styles.css` 保持"零色彩字面量"可机检。
- **代价（技术债，明写）**：**`FALLBACK_TOKENS` 是宿主 `main.css` 默认色的副本**，会随宿主漂移——只在"拿不到推送"的场景可感知（宿主换配色时兜底还停在旧值）。它被三道门禁钉住：`styles.css` 消费的 token ⊆ `FALLBACK_TOKENS` 键 ⊆ 宿主白名单（并与宿主 `main.css` 的 `:root` 逐条比对）；`test/fallbackInputs.test.js` 另外钉住"输入类控件消费的每个 token 都有兜底值"与"输入框底色不得与容器同色"。
- **风险**：`themeId` 的 `/light/i` 启发式对第三方主题可能判错（只影响原生控件底色）；跨窗口主题同步依赖宿主侧的 `storage` 事件通道（**假设**见下）。
- **跨窗口通道的假设与退路**：本扩展**不直接依赖** `storage`——它只依赖"宿主会在主题变化时再推一次 `obox-theme`"。宿主当前的实现是：主窗口 `storage` 事件 → `applyExternal` → 通知 → 对 `url` 型 iframe 重新推送（宿主 ADR-0022 决策 4）。因此**若 `storage` 事件在目标平台/版本不可靠**（多窗口、不同 profile 等），宿主需改成**主进程广播**（`ipcMain` → `webContents.send` 给所有窗口，仓内已有同款写法：`src/main/fs.ts:39-41`）——本扩展侧**无需改动**（协议不变，仍是收到 `obox-theme` 就 `setProperty`）。这条退路记在宿主 ADR-0022，不构成扩展侧的待办。
- **退场条件**（任一落地即可删掉 `FALLBACK_TOKENS`，只留"拿不到就 warn"）：
  1. 宿主能在**首帧之前**把 token 交给页面（`app://` 协议层注入 `<style>`，或把 `url` 型卡片 `srcdoc` 化）；
  2. 扩展能声明并**强制校验**最低宿主版本（保证推送一定到）。
     （"`api.theme` 提供 `getTokens()`"**不构成**退场理由：子窗口里没有 `api`。）

## 实测记录（2026-10-11，本机 Windows 11）

- `test/themeBridge.test.js`：11 个用例全绿——含"启动即写满 25 条兜底"、"收到推送即覆盖且不再重发"、"3 次无响应只 warn 一次"、"来源非 parent 的消息被忽略"、`dispose` 后不再响应，以及本轮的 `N1`（仅兜底状态下输入类控件的关键 token 逐条有值）与 `L4`（定时器记账：只取消**还没触发**的，已触发的出账后不再重复取消）。
- `test/stylesTokens.test.js`：`styles.css` 零色值/零字体族/只引用白名单 token；消费的 token ⊆ 兜底表 ⊆ 宿主白名单，且与宿主 `main.css` 的 `:root` 逐条一致。
- `test/fallbackInputs.test.js`（本轮新增）：仅兜底状态下的对比度实测 —— 正文 `--fg`/`--bg-input` ≈ **6.9:1**、正文/窗口底 ≈ **10.4:1**（≥4.5:1）；placeholder `--fg-dim`/`--bg-input` ≈ **2.2:1**（宿主没有 placeholder 专用 token，按设计 §2.5 E6 用 `--fg-dim`，门禁只钉"不许更差"）。
- **真机发现（N1，已修）**：宿主 dark 默认 token 里 `--bg-input` 与 `--border` 是**同一个值** `#3c3c3c`，而高级区容器 `.accordion` 原本也用 `--bg-input` ⇒ 输入框的**底色、描边、容器**三者同色，框"消失"了（用户原话："高级选项里文本框基本上看不清"）。修法：`.accordion` 改用最深一档 `--bg`，形成 面板 → 凹槽 → 输入框 三层；`test/fallbackInputs.test.js` 把"输入框底色不得与任何容器底色相同/同色"钉成断言。
- **真机未验证项**：
  1. 打包态（`file://` 父文档 vs `app://` 子窗口）与 dev 态的 `postMessage` 送达差异未单独验证（协议两侧一致，但只在 dev 态跑过真机）；
  2. 第三方主题（`themeId` 不含 `light` 的浅色主题）下 `color-scheme` 会被判成 `dark`，未真机核对原生控件底色；
  3. 宿主"主题变化 → 重新推送"的端到端时延（含 `storage` 通道是否成立）未在真机计时，见上文"跨窗口通道的假设与退路"。

## 确认偏离

- **取代 ADR-0001 决策 5 的后半句**：ADR-0001 写的是"页面自带一套 CSS 变量 ⇒ **不跟随宿主主题**"。本 ADR 落地后改为"**跟随宿主主题（消息送达） + 内置兜底**"，ADR-0001 那句不再成立（已在该处标注）。
- **兜底表不进 `styles.css`**：设计早期草案想把兜底值写成 CSS `var(--token, #1e1e1e)` 形式，实现按 R-D1 的"零色彩字面量"要求否决（兜底只在 `src/theme.js` 一处）。
- **不做 `prefers-color-scheme` 跟随**：子窗口是独立文档、`color-scheme` 由宿主推送决定；加系统级媒体查询会在"宿主主题 ≠ 系统主题"时打架，故不实现。
