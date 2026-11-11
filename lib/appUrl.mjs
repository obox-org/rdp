/**
 * App 卡片页面 URL 的推导（纯函数，`node --test` 可测；宿主/渲染两边同一份代码）。
 *
 * **为什么不能直接写 `new URL('./ui/index.html', import.meta.url)`**：
 * obox 2.0.0 起用户扩展在 **Extension Host Process** 里执行，宿主按**磁盘路径**（`file://`）动态
 * `import()` 入口 ⇒ 入口的 `import.meta.url` 是 `file:///…/extensions/rdp.chenzhi/index.js`，
 * 直接拼出来的是 `file://` 页面地址。而主窗口的 CSP 是 `default-src 'self' app:`（`src/renderer/index.html`），
 * `frame-src` 回落到 `default-src` ⇒ **`file://` 的 iframe 被 CSP 拦掉，卡片窗口一片空白**。
 * 页面必须仍是 `app://` 形状（见 `docs/extension-api/guides-user.md` §4）。
 *
 * 两种加载方式各自怎么算：
 *
 * | 入口怎么加载 | `import.meta.url` | 页面 URL |
 * | --- | --- | --- |
 * | 宿主进程（2.0.0 默认） | `file://<扩展目录>/index.js` | 按**入口的父目录名**判定：`extensions` ⇒ `app://extensions/<目录名>/…`，其余 ⇒ `app://debug/<目录名>/…` |
 * | 渲染进程（关掉宿主开关 / 内置扩展） | `app://extensions\|debug/<id>/index.js` | 同源相对解析即可（协议已经是 `app:`） |
 *
 * ## 为什么**不**复刻"安装目录命名规则"（1.1.0 的线上事故）
 *
 * 早期实现把宿主的 `deriveDirName`（`src/main/oixCore.ts`）复刻了一份，用"目录名 == 复刻结果"
 * 来区分安装态与调试态。该规则是 `<name>.<清洗后 author>`，而复刻里写成了 `<name>_<author>`：
 * 于是真实安装目录 `rdp.chenzhi` 与复刻值 `rdp_chenzhi` 不等 ⇒ **安装态被判成调试态**，
 * 页面地址变成 `app://debug/rdp.chenzhi/ui/index.html`；`app://debug/` 只映射 `--debug-extension`
 * 声明过的目录，协议处理器直接回 404 `not found` ⇒ 用户打开卡片只看到 "not found"。
 * 测试当时还断言了那个错值（`rdp_chenzhi`），所以本地全绿、线上必坏。
 *
 * 现在只看**结构**：入口文件的父目录叫 `extensions` 就是"装好的扩展"（宿主两个扩展根
 * `<安装目录>/extensions` 与 `<userData>/extensions` 都叫这个名字，`app://extensions/<id>` 两个根
 * 都会查），否则按 `--debug-extension` 的既有约定"id == 目录名"走 `app://debug/<目录名>`。
 * 不依赖任何命名规则 ⇒ 宿主改规则也不会把这里改坏。
 *
 * 已知限制（与 webapp 一致）：`--debug-extension` 的目录**恰好**放在叫 `extensions` 的目录下时
 * （例如仓库里的 `…\obox\extensions\rdp`）会被认成安装态。开发期请用渲染进程回退模式
 * （`OBOX_EXTENSION_HOST=0`），那样入口本身就是 `app://debug|extensions/…`，走相对解析。
 */

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
 * 从入口目录路径推出 `app://` 主机名与目录名。
 *
 * @param {string} dirPath 入口所在目录的路径（已解码；分隔符 `/` 或 `\` 都行）
 * @returns {{ host: 'extensions' | 'debug', dirName: string }}
 */
export function resolveAppHost(dirPath) {
  const segments = String(dirPath ?? '')
    .split(/[\\/]/)
    .filter(Boolean)
  const dirName = segments.pop() ?? ''
  if (!dirName) throw new Error(`无法从入口路径推导目录名：${dirPath}`)
  const parent = (segments.pop() ?? '').toLowerCase()
  return { host: parent === 'extensions' ? 'extensions' : 'debug', dirName }
}

/**
 * 由入口的 `import.meta.url` 推出 App 卡片 / 子窗口页面 URL。
 *
 * @param {string} entryUrl 入口模块的 URL（宿主里是 `file://`，渲染进程里是 `app://`）
 * @param {{ page?: string }} [options] `page` 是相对扩展目录的页面路径，缺省 `ui/index.html`
 * @returns {string} 形如 `app://extensions/<安装目录名>/ui/index.html` 的页面 URL
 */
export function appPageUrl(entryUrl, options) {
  const { page = 'ui/index.html' } = options ?? {}
  const rel = normalizePage(page)
  const base = new URL('.', entryUrl)

  // 渲染进程模式：入口本身就来自 app://（安装态 app://extensions/<id>/，调试态 app://debug/<id>/），
  // 相对解析天然得到正确的页面 URL，且不需要知道这两种 host 的差别。
  if (base.protocol === 'app:') {
    const entrySegments = base.pathname.split('/').filter(Boolean)
    // 长度必须 ≥ 2（host 段 + 目录名段），否则是 app:// 根这种异常入口
    if (entrySegments.length >= 2 && entrySegments[0] === 'debug') {
      return `app://debug/${encodeURIComponent(entrySegments[1])}/${rel}`
    }
    return new URL(rel, base).href
  }

  if (base.protocol !== 'file:') {
    throw new Error(`不支持的入口 URL 协议：${base.protocol}（只认 file: / app:）`)
  }

  // 宿主进程模式：`pathname` 是 URL 编码的（用户名带空格/中文时更明显），先解码再拆段。
  const { host, dirName } = resolveAppHost(decodeURIComponent(base.pathname))
  return `app://${host}/${encodeURIComponent(dirName)}/${rel}`
}
