/**
 * App 卡片页面 URL 的推导（纯函数，`node --test` 可测；宿主/渲染两边同一份代码）。
 *
 * **为什么不能直接写 `new URL('./ui/index.html', import.meta.url)`**：
 * obox 2.0.0 起用户扩展在 **Extension Host Process** 里执行，宿主按**磁盘路径**（`file://`）动态
 * `import()` 入口 ⇒ 入口的 `import.meta.url` 是 `file:///…/extensions/rdp_chenzhi/index.js`，
 * 直接拼出来的是 `file://` 页面地址。而主窗口的 CSP 是 `default-src 'self' app:`（`src/renderer/index.html`），
 * `frame-src` 回落到 `default-src` ⇒ **`file://` 的 iframe 被 CSP 拦掉，卡片窗口一片空白**。
 * 页面必须仍是 `app://` 形状（见 `docs/extension-api/guides-user.md` §4）。
 *
 * 两种加载方式各自怎么算：
 *
 * | 入口怎么加载 | `import.meta.url` | 页面 URL |
 * | --- | --- | --- |
 * | 宿主进程（2.0.0 默认） | `file://<扩展目录>/index.js` | 由**目录名**拼 `app://extensions/<安装目录名>/…`（调试扩展是 `app://debug/<目录名>/…`） |
 * | 渲染进程（关掉宿主开关 / 内置扩展） | `app://extensions|debug/<id>/index.js` | 同源相对解析即可（协议已经是 `app:`） |
 *
 * 安装目录名 = `<name>_<清洗后 author>`（`src/main/oixCore.ts` 的 `deriveDirName`），带作者时
 * 与 `manifest.name` 不同 ⇒ 绝不能硬编码 `app://extensions/rdp/`。
 */

/**
 * 复刻 `src/main/oixCore.ts` 的 `deriveDirName`：`<name>_<author 小写去非法字符>`，作者清洗后为空
 * 时只用 name。**这是宿主的安装目录命名规则**，扩展侧没法 import，只能复刻；改宿主规则时这里要同步
 * （`test/appUrl.test.js` 用真实清单做对照，规则漂移会在"安装态"用例上立刻红）。
 *
 * @param {string} name `manifest.name`
 * @param {string} [author] `manifest.author`
 * @returns {string} 安装器会创建的目录名
 */
export function deriveInstallDirName(name, author) {
  const safeAuthor = String(author ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
  return safeAuthor ? `${String(name)}_${safeAuthor}` : String(name)
}

/** 页面相对路径归一（容忍 `./ui/index.html`；拒绝 `..` 与绝对路径） */
function normalizePage(page) {
  const raw = String(page ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!raw) throw new Error('页面路径不能为空')
  if (raw.startsWith('/')) throw new Error(`页面路径不能是绝对路径: ${page}`)
  if (raw.split('/').includes('..')) throw new Error(`页面路径不能含 ..: ${page}`)
  return raw.replace(/^\.\//, '')
}

/**
 * 由入口的 `import.meta.url` 推出 App 卡片 / 子窗口页面 URL。
 *
 * @param {string} entryUrl 入口模块的 URL（宿主里是 `file://`，渲染进程里是 `app://`）
 * @param {{ name: string, author?: string, page?: string }} options `name`/`author` 取清单里的原值
 *   （`name` 用来判"我是不是安装态目录"）；`page` 是相对扩展目录的页面路径，缺省 `ui/index.html`
 * @returns {string} 形如 `app://extensions/<安装目录名>/ui/index.html` 的页面 URL
 */
export function appPageUrl(entryUrl, options) {
  const { name, author, page = 'ui/index.html' } = options ?? {}
  const rel = normalizePage(page)
  const base = new URL('.', entryUrl)

  // 渲染进程模式：入口本身就来自 app://（安装态 app://extensions/<id>/，调试态 app://debug/<id>/），
  // 相对解析天然得到正确的页面 URL，且不需要知道这两种 host 的差别。
  if (base.protocol === 'app:') return new URL(rel, base).href

  if (base.protocol !== 'file:') {
    throw new Error(`不支持的入口 URL 协议：${base.protocol}（只认 file: / app:）`)
  }

  // 宿主进程模式：从磁盘路径取"我所在的目录名"。`pathname` 是 URL 编码的（用户名带空格/中文时更明显），
  // 先解码再取最后一段。
  const dirName = decodeURIComponent(base.pathname).split(/[\\/]/).filter(Boolean).pop()
  if (!dirName) throw new Error(`无法从入口路径推导目录名：${entryUrl}`)

  // 目录名与"安装器会创建的目录名"一致 ⇒ 安装态，走 app://extensions/<安装目录名>/；
  // 不一致 ⇒ 不是安装态（`--debug-extension id@<本地目录>`，目录名即 id），走 app://debug/<目录名>/。
  // 判据只依赖清单与自身路径，两者都是扩展确定知道的；`app://debug/<id>` 的 id 由 `--debug-extension`
  // 参数给出，本扩展的调试约定是"id = 目录名"（README §3 的 `rdp@…\extensions\rdp`）。
  const host = dirName === deriveInstallDirName(name, author) ? 'extensions' : 'debug'
  return `app://${host}/${encodeURIComponent(dirName)}/${rel}`
}
