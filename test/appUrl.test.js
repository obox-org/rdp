/**
 * `lib/appUrl.mjs` 的门禁：App 卡片页面 URL 在**宿主模式**（入口 `file://` 加载）下必须仍是
 * `app://` 形状，否则主窗口 CSP（`default-src 'self' app:`）会把子窗口 iframe 拦掉、卡片一片空白。
 *
 * **1.1.0 的线上事故（本文件的核心用例）**：旧实现复刻宿主的安装目录命名规则，且把分隔符写成了
 * `_`（宿主是 `.`）⇒ 真实安装目录 `rdp.chenzhi` 被判成"调试态"，页面地址成
 * `app://debug/rdp.chenzhi/ui/index.html`，协议侧直接 404 `not found`。当时的用例断言了那个错值，
 * 所以本地全绿、线上必坏。现在只看入口的**父目录名**是否叫 `extensions`，不依赖任何命名规则。
 *
 * 覆盖三种真实来源：
 * 1. 宿主进程 + 安装态（`file://…/extensions/<任意目录名>/index.js`）⇒ `app://extensions/<目录名>/…`
 * 2. 宿主进程 + 调试态（`file://…/<其它父目录>/<目录名>/index.js`）⇒ `app://debug/<目录名>/…`
 * 3. 渲染进程（关掉宿主开关时入口经 `app://` 加载）⇒ 同源相对解析
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appPageUrl, resolveAppHost } from '../lib/appUrl.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))

/** 宿主真实的安装目录命名（`src/main/oixCore.ts` 的 `deriveDirName`：`<name>.<author>`） */
const HOST_INSTALLED_DIR = `${manifest.name}.${String(manifest.author ?? '').toLowerCase()}`

test('宿主模式 + 安装态：真实安装目录 rdp.chenzhi ⇒ app://extensions/<目录名>/ui/index.html', () => {
  // 回归点：1.1.0 这里曾推出 app://debug/rdp.chenzhi/…（协议侧 404 not found）
  const entry = `file:///C:/Users/chenzhi/AppData/Roaming/obox/extensions/${HOST_INSTALLED_DIR}/index.js`
  const url = appPageUrl(entry)
  assert.equal(url, `app://extensions/${HOST_INSTALLED_DIR}/ui/index.html`)
  assert.ok(url.startsWith('app://extensions/'), `安装态必须走 extensions：${url}`)
  assert.ok(!url.includes('://debug/'), `安装态不得被判成调试态：${url}`)
})

test('安装态的目录名不影响判定：下划线 / 点 / 无作者 都走 app://extensions/', () => {
  for (const dir of ['rdp_chenzhi', 'rdp.chenzhi', 'rdp', 'rdp.ChenZhi']) {
    const url = appPageUrl(`file:///C:/Users/chenzhi/AppData/Roaming/obox/extensions/${dir}/index.js`)
    assert.equal(url, `app://extensions/${dir}/ui/index.html`, `目录名 ${dir}`)
  }
})

test('系统根安装（<安装目录>/extensions/<目录名>）同样走 app://extensions/', () => {
  const entry = 'file:///C:/Program%20Files/obox/resources/extensions/python3.11_runtime/index.js'
  assert.equal(
    appPageUrl(entry),
    'app://extensions/python3.11_runtime/ui/index.html',
    '系统根与用户根的目录名都叫 extensions，协议侧两个根都会查'
  )
})

test('宿主模式 + 调试态：父目录不是 extensions ⇒ app://debug/<目录名>/ui/index.html', () => {
  // 回归点：1.1.0 这里曾推出 app://extensions/rdp/…（本地无该安装目录，同样打不开）
  const entry = 'file:///D:/work/probe-ext/index.js'
  assert.equal(appPageUrl(entry), 'app://debug/probe-ext/ui/index.html')
})

test('resolveAppHost：只按父目录名判定主机', () => {
  assert.deepEqual(resolveAppHost('C:/a/extensions/rdp.chenzhi'), {
    host: 'extensions',
    dirName: 'rdp.chenzhi'
  })
  assert.deepEqual(resolveAppHost('C:/a/ExtensionS/rdp.chenzhi'), {
    host: 'extensions',
    dirName: 'rdp.chenzhi',
    // 大小写不敏感：Windows 上目录名大小写不可靠
  })
  assert.deepEqual(resolveAppHost('C:/a/plugins/x'), { host: 'debug', dirName: 'x' })
  // 反斜杠同样能拆
  assert.deepEqual(resolveAppHost('C:\\a\\extensions\\y'), { host: 'extensions', dirName: 'y' })
  assert.throws(() => resolveAppHost(''), /无法从入口路径推导目录名/)
})

test('渲染进程模式：入口本身就是 app:// ⇒ 同源相对解析', () => {
  assert.equal(
    appPageUrl('app://extensions/rdp.chenzhi/index.js'),
    'app://extensions/rdp.chenzhi/ui/index.html'
  )
  assert.equal(appPageUrl('app://debug/rdp/index.js'), 'app://debug/rdp/ui/index.html')
  assert.equal(
    appPageUrl('app://builtin/rdp/index.js'),
    'app://builtin/rdp/ui/index.html',
    '内置扩展的 host 原样保留'
  )
})

test('任何情况下都不返回 file://（CSP 会拦掉 iframe）', () => {
  for (const entry of [
    'file:///C:/a/extensions/rdp.chenzhi/index.js',
    'file:///C:/a/extensions/rdp/index.js',
    'file:///D:/work/probe/index.js',
    'app://extensions/rdp.chenzhi/index.js',
    pathToFileURL(join(root, 'index.js')).href
  ]) {
    const url = appPageUrl(entry)
    assert.match(url, /^app:\/\/(extensions|debug)\//, `${entry} → ${url}`)
    assert.ok(!url.startsWith('file:'), `${entry} → ${url}`)
  }
})

test('路径里的百分号编码会先解码：用户名带空格/中文也能取到正确的目录名', () => {
  const entry = `file:///C:/Users/%E5%BC%A0%20san/AppData/Roaming/obox/extensions/${HOST_INSTALLED_DIR}/index.js`
  assert.equal(appPageUrl(entry), `app://extensions/${HOST_INSTALLED_DIR}/ui/index.html`)
})

test('非 ASCII 目录名按 URL 编码写进 app://（协议侧再解码）', () => {
  const entry = 'file:///D:/work/%E8%B0%83%E8%AF%95/index.js' // …/调试/index.js
  assert.equal(appPageUrl(entry), `app://debug/${encodeURIComponent('调试')}/ui/index.html`)
})

test('page 参数：容忍 ./ 前缀、反斜杠；拒绝绝对路径 / .. / 空', () => {
  const entry = `file:///C:/a/extensions/${HOST_INSTALLED_DIR}/index.js`
  assert.equal(
    appPageUrl(entry, { page: './ui/index.html' }),
    `app://extensions/${HOST_INSTALLED_DIR}/ui/index.html`
  )
  assert.equal(
    appPageUrl(entry, { page: 'ui\\index.html' }),
    `app://extensions/${HOST_INSTALLED_DIR}/ui/index.html`
  )
  assert.throws(() => appPageUrl(entry, { page: '../index.js' }), /\.\./)
  assert.throws(() => appPageUrl(entry, { page: '/abs/page.html' }), /绝对路径/)
  assert.throws(() => appPageUrl(entry, { page: '  ' }), /不能为空/)
})

test('不支持的入口协议直接抛错（不静默给一个打不开的 URL）', () => {
  assert.throws(() => appPageUrl('https://example.com/index.js'), /不支持的入口 URL 协议/)
})

test('index.js 用真实清单参数调用 appPageUrl（不传 name/author 也能拼对）', () => {
  const source = readFileSync(join(root, 'index.js'), 'utf8')
  assert.match(
    source,
    /appPageUrl\(import\.meta\.url, \{ page: PAGE_PATH \}\)/,
    'index.js 应只传 page（目录名由入口路径推出，不再依赖复刻命名规则）'
  )
  // 卡片上显示的 author 仍要与清单一致
  const authorMatch = /const EXT_AUTHOR = '([^']*)'/.exec(source)
  assert.ok(authorMatch, 'index.js 应声明 EXT_AUTHOR')
  assert.equal(authorMatch[1], manifest.author, 'EXT_AUTHOR 与 manifest.author 不一致')
  assert.equal(manifest.name, 'rdp')
})
