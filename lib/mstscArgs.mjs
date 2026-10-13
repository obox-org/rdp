/**
 * `cmd /c start "" <mstsc 绝对路径> "<.rdp 绝对路径>"` 的命令行构造（纯函数，零依赖）。
 *
 * **为什么绕一层 cmd**：直接 `spawn('mstsc.exe', [rdpPath])` 会让 mstsc 成为助手的**直接子进程**，
 * 于是任务管理器里能看见 `obox.exe → 助手 node → mstsc.exe` 这条链。经 `cmd /c start` 派发后
 * `cmd` 在 ~60ms 内自己退出，mstsc 的父进程变成一条**已断开的链**（不再属于 obox 进程树）。
 * 完整取舍（被否决的 WMI / explorer 关联、退出码判据的代价、真机实测）见
 * `docs/adr/0003-mstsc-orphan-launch-via-cmd.md`。
 *
 * **三个不能改的点**（改了会静默出错，单测全绿也不代表真机对）：
 *
 * 1. **必须是参数数组，不能把整串命令写成一个参数**。写成
 *    `spawn('cmd.exe', ['/c', 'start "" mstsc.exe "C:\\a b\\1.rdp"'])` 时，Node 在 Windows 上会为
 *    "含空格的单参数"**整体再包一层引号**，真正的命令行变成
 *    `cmd /c "start "" mstsc.exe "C:\a b\1.rdp""`，`cmd` 的引号消解规则会把里层引号全部吃掉 ⇒
 *    `start` 收到的目标与路径不是我们要的那两个 token（真机现象：路径在 `&` 处被截断，`cmd`
 *    却仍然 `exit 0`——静默走错）。
 * 2. **本模块不做任何引号/转义**：原样返回，转义交给 Node 在
 *    `windowsVerbatimArguments: false` 下按"标准命令行解析器"完成（`helper.cjs` 的 spawn 处写死了
 *    这个取值，理由见那里与 ADR-0003）。⚠️ 这里**绝不能**照着 `quoteForCmdkey` 加一层引号。
 * 3. **`start` 后面的空 `""` 必须保留**：它是窗口标题占位；没有它时 `start` 会把第一个带引号的
 *    参数**当成窗口标题**，路径就丢了。
 *
 * **只拦 `%VAR%` 与引号/换行**（`&` `^` `|` `<` `>` `(` `)` `!` 与**不配对的单个 `%`** 一律放行）：
 * 真机实测（Windows 11 build 26200）这些字符全部原样到达目标进程，唯一的例外是 `%VAR%` 会被
 * cmd 展开成变量值（`%TEMP%` → 真实临时目录，路径被**静默改写到别的目录**）。
 *
 * ⚠️ **与规格 §6.1 的一处刻意偏离（已记入 ADR-0003）**：§6.1 的示例代码写的是
 * `if (file.includes('%')) throw …`（拦任何 `%`），而 §6.3 的字符表与 §17.2/§17.3 的测试矩阵
 * 要求"`%` 不配对（`100% done`）原样通过、只拦 `%VAR%`"。三处不能同时成立，本实现按
 * **§6.3 + §17** 落地（判据 = 存在一对 `%…%`），理由：① 它是被真机探针 P-3 覆盖的口径；
 * ② §17 的矩阵是本次验收的机器可判门禁。真实的可达路径只有
 * `<扩展 data 目录>/rdp/<正整数 id>.rdp`（文件名由扩展生成，唯一可能含怪字符的成分是 Windows
 * 用户名），两种口径在这个集合上**都不会**误派发——差别只在"用户名里恰好有一个 `%`"时是
 * 明确报错还是正常打开。
 */

/** `%VAR%` 形态（含 `%%`）：cmd 会把它展开成变量值（未定义则是空串）⇒ 路径被静默改写 */
const CMD_VARIABLE_PATTERN = /%[^%]*%/

/**
 * `cmd /c start "" <mstsc 绝对路径> <.rdp 绝对路径>` 的参数数组。
 *
 * 规则：**不做任何引号/转义**（见文件头第 2 条），原样返回。
 *
 * @param {string} mstscPath mstsc.exe 的绝对路径（由 `resolveMstscPath` 得到）
 * @param {string} rdpPath   生成的 `.rdp` 绝对路径
 * @returns {string[]} 恰好 5 个元素：`['/c', 'start', '', <mstsc>, <.rdp>]`
 * @throws {Error} `rdpPath` 含 `%VAR%` / 双引号 / 换行（cmd 会吃掉它们，无法安全派发）
 */
export function buildStartArgs(mstscPath, rdpPath) {
  const target = String(mstscPath ?? '').trim()
  const file = String(rdpPath ?? '').trim()
  if (!target) throw new Error('buildStartArgs 需要 mstsc 绝对路径')
  if (!file) throw new Error('buildStartArgs 需要 .rdp 绝对路径')
  if (CMD_VARIABLE_PATTERN.test(file)) {
    throw new Error(`.rdp 路径含 %VAR%：cmd 会把它当变量展开，无法安全派发（${file}）`)
  }
  if (/["\r\n]/.test(file)) throw new Error(`.rdp 路径含引号或换行，无法安全派发（${file}）`)
  return ['/c', 'start', '', target, file]
}

/**
 * mstsc.exe 的绝对路径：优先 `%SystemRoot%\System32`，缺失时退回 `windir`、再退回 `C:\Windows`。
 *
 * **为什么用绝对路径而不是 `mstsc.exe`**：`start` 解析程序名依赖 `PATH` + `App Paths` +
 * `PATHEXT`，而宿主给助手的**最小环境**里只有 `PATH`/`SystemRoot`/`TEMP`/`TMP`/`HOME`/
 * `USERPROFILE`/`LANG`（没有 `PATHEXT`，见 `src/main/ipcTransport.ts:27-35`）；绝对路径把这几个
 * 变量从等式里彻底拿掉。另外：程序名解析失败时 `start` 会弹"选择打开方式"对话框并**挂住 cmd
 * 不退出**，所以调用方必须先 `existsSync` 一次，把这条分支前移成毫秒级的可读错误。
 *
 * @param {Record<string, string|undefined>} [env] 默认 `process.env`（可注入，便于单测）
 * @returns {string} 形如 `C:\Windows\System32\mstsc.exe`
 */
export function resolveMstscPath(env = process.env) {
  const root = String(env?.SystemRoot ?? env?.windir ?? 'C:\\Windows').replace(/[\\/]+$/, '')
  return `${root}\\System32\\mstsc.exe`
}
