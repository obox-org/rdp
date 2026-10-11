# RDP 远程桌面扩展：起进程、凭据与存储的取舍

## 背景

要在 obox 里做一个 Windows 远程桌面管理器（App 卡片 → 子窗口里的连接卡片列表：打开 / 编辑 / 删除确认 / 右上角新增模态框）。扩展是**用户扩展**（独立仓库 + `.oix` 分发），而这类扩展面临三条硬约束：

1. **扩展跑在渲染进程**，`nodeIntegration:false` + `contextIsolation:true` → 没有 `child_process`、没有 `require`；`api.shell.openPath` 虽存在且不校验路径，但**必须绝对路径**，而扩展拿不到任何绝对路径（`src/main/fs.ts:12-19` 只收相对路径）。
2. 而这件事**必须起进程**：预置凭据只能用 `cmdkey.exe`，打开连接只能用 `mstsc.exe`。
3. 宿主原有"`.js/.cjs/.mjs` 助手用宿主自带 Node 运行"的便利约定**实际是坏的**（跑成 Electron 应用模式、stdin 不接）。

## 决策

1. **起进程走 `api.ipc` + 随包 `helper.cjs`**，而不是让宿主新增通用 `exec` 能力，也不随包编译型助手。理由：`api.ipc` 是既有能力（`contributes.ipcChannels` 声明 stdio 通道，宿主 spawn 扩展目录内的程序），只需修一处运行时缺陷（见 ADR-0021 决策 3）；宿主 API 面不变，扩展侧只多一个 `.cjs` 与一套 JSON-RPC。被否决的两条：宿主 `api.shell.exec` 白名单（新增 API 面 + 策略，且与"扩展拿不到路径"无关地扩大能力）、Go 编译助手（引入构建链与二进制，且 SQLite 就得改由 Go 持有）。
2. **helper 协议用标准 JSON-RPC 2.0（ndjson 分帧）**：宿主 `ipcCore` 双向强制 `jsonrpc:"2.0"`，缺了即 `protocol-error` 关通道——所以不能自定义精简形状。
3. **密码：只用 `cmdkey`，绝不写 `password 51:b:`**。后者是社区逆向的 DPAPI blob，绑定"当前用户 + 本机"、**不可分发**，且宿主没有任何接口能取出 `api.secrets` 的原始密文（`src/main/secrets.ts` 只存 base64）。凭据目标串取 `TERMSRV/<主机>`；**非默认端口官方未文档化**，故 `TERMSRV/<host>` 与 `TERMSRV/<host>:<port>` 两条都写、以 `cmdkey /list` 核对。
4. **存储用宿主 `api.sqlite`（`open('rdp.db')`，库在固定目录 `<扩展>/data/`）+ `api.secrets` 存密码**。否决"helper 自持 SQLite 放扩展目录之外"与"JSON 状态（Memento）"：前者把数据管到宿主之外、与 `api.fs` 语义分裂，后者丢掉了用户的明确诉求（要 SQLite）。**本决策依赖 ADR-0021 决策 1**（覆盖安装保留 `data/`）才成立；否则升级即清库。
5. **界面只做 App 卡片**：用户扩展**不能**贡献主窗口 `navItems[].view`（入口没有 Vue 构建管线），而 `api.app` 又没有"用代码打开卡片"的能力，因此 App 卡片是唯一入口；树视图做不到"卡片 + 三按钮 + 模态框"。页面**自带一套 CSS 变量**——`app://` 静态页是跨源文档，拿不到宿主注入的主题 token（`src/renderer/src/AppWindow.vue:38-52`）。**本决策的后半句已被 `docs/adr/0002-app-window-theme-bridge-and-fallback.md` 取代**：宿主自 2026-10 起对 `url` 型卡片单向推送 `obox-theme`，本扩展改为「跟随宿主主题 + 内置兜底」，不再"自带一套固定配色"。
6. **验收边界**：止于"`cmdkey /list` 出现 `TERMSRV/<目标>` 且 `mstsc.exe` 进程真的起来（随即结束）"，**不发起真实远程会话**（会全屏接管用户桌面）。真实会话中的多屏 / 全屏 / 音频、以及非默认端口的凭据目标串，均标注"未验证"。

## 后果

- **好处**：扩展侧零运行期依赖（只用注入的 `api` + 随包 `.cjs`）；密码不落明文（`api.secrets`），也不出现在 `.rdp` 文件里；连接数据在 `api.sqlite` 里可真正增删改查且**升级不丢**（依赖 ADR-0021）；界面与 obox 一致但不受宿主主题变更影响。
- **代价**：多一个 helper 文件与一套 JSON-RPC 协议要测；密码在调用 `cmdkey` 时经 argv 传递，**极短时间**出现在进程表（与手敲 `cmdkey` 同级，README 写明）；`uninstall` 需自己清理 `api.secrets`（宿主不清理、无列表接口，只能先查库里的 id 再逐个删）。
- **退场条件**：若宿主将来提供"受限进程能力"或"扩展可取得自身绝对路径"，可去掉 helper 直接写 `.rdp` + `openPath`；若宿主把主题 token 注入 `app://` 页面，可改为跟随宿主主题；若非默认端口的凭据目标串被官方文档确认，可只写一条。

## 确认偏离

- **不实现 `iconUrl`（子窗口任务栏图标）**：`spec` 的 R-B1 曾列出它，实现按本 ADR 与设计 §3.5 的决定省略（卡片图标用内联 SVG 即可，也免去额外准备 PNG 资源）。其余卡片字段（`id`/`name`/`version`/`author`/`description`/`icon`/`url`/`multiOpen`/宽高）均按 spec 实现。若将来要在子窗口显示任务栏图标，需补 `icon.png` 并让 `pack.mjs` 的 `icon.*` 白名单命中它。
- **`probe` 是诊断接口**（无界面入口）：`helper.cjs --selftest` 与 README 都指向它；设计 §3.3 曾提"环境检查按钮"，但 §3.9 界面设计未包含该按钮，故不实现。
