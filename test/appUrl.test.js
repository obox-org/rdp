/**
 * `lib/appUrl.mjs` 的门禁：App 卡片页面 URL 在**宿主模式**（入口 `file://` 加载）下必须仍是
 * `app://` 形状，否则主窗口 CSP（`default-src 'self' app:`）会把子窗口 iframe 拦掉、卡片一片空白。
 *
 * 覆盖三种真实来源：
 * 1. 宿主进程 + 安装态（`file://…/extensions/rdp_chenzhi/index.js`）⇒ `app://extensions/rdp_chenzhi/…`
 * 2. 宿主进程 + 调试态（`file://…/extensions/rdp/index.js`）⇒ `app://debug/rdp/…`
 * 3. 渲染进程（关掉宿主开关时入口经 `app://` 加载）⇒ 同源相对解析
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appPageUrl, deriveInstallDirName } from '../lib/appUrl.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
/** 安装器会创建的目录名（`src/main/oixCore.ts` 的 `deriveDirName`） */
const INSTALLED_DIR = deriveInstallDirName(manifest.name, manifest.author)

test('deriveInstallDirName 复刻安装器的目录命名规则', () => {
  assert.equal(deriveInstallDirName('rdp', 'chenzhi'), 'rdp_chenzhi')
  assert.equal(deriveInstallDirName('rdp', 'ChenZhi'), 'rdp_chenzhi', '作者应小写')
  assert.equal(deriveInstallDirName('rdp', 'chen zhi!'), 'rdp_chenzhi', '非法字符应被去掉')
  assert.equal(deriveInstallDirName('rdp', ''), 'rdp', '作者为空时只用 name')
  assert.equal(deriveInstallDirName('rdp', undefined), 'rdp')
  assert.equal(deriveInstallDirName('rdp', '张三'), 'rdp', '清洗后为空同样只用 name')
})

test('宿主模式 + 安装态：file:// 入口 ⇒ app://extensions/<安装目录名>/ui/index.html', () => {
  const entry = 'file:///C:/Users/chenzhi/AppData/Roaming/obox/extensions/rdp_chenzhi/index.js'
  assert.equal(
    appPageUrl(entry, { name: manifest.name, author: manifest.author }),
    'app://extensions/rdp_chenzhi/ui/index.html'
  )
})

test('宿主模式 + 调试态：调试目录名 ≠ 安装目录名 ⇒ app://debug/<目录名>/ui/index.html', () => {
  const entry = 'file:///C:/Users/chenzhi/Documents/workspace/web/obox/extensions/rdp/index.js'
  assert.equal(
    appPageUrl(entry, { name: manifest.name, author: manifest.author }),
    'app://debug/rdp/ui/index.html'
  )
})

test('渲染进程模式：入口本身就是 app:// ⇒ 同源相对解析（安装态 / 调试态各一条）', () => {
  const opts = { name: manifest.name, author: manifest.author }
  assert.equal(
    appPageUrl('app://extensions/rdp_chenzhi/index.js', opts),
    'app://extensions/rdp_chenzhi/ui/index.html'
  )
  assert.equal(appPageUrl('app://debug/rdp/index.js', opts), 'app://debug/rdp/ui/index.html')
})

test('任何情况下都不返回 file://（CSP 会拦掉 iframe）', () => {
  const opts = { name: manifest.name, author: manifest.author }
  for (const entry of [
    'file:///C:/a/extensions/rdp_chenzhi/index.js',
    'file:///C:/a/extensions/rdp/index.js',
    'app://extensions/rdp_chenzhi/index.js',
    pathToFileURL(join(root, 'index.js')).href
  ]) {
    const url = appPageUrl(entry, opts)
    assert.match(url, /^app:\/\/(extensions|debug)\//, `${entry} → ${url}`)
    assert.ok(!url.startsWith('file:'), `${entry} → ${url}`)
  }
})

test('路径里的百分号编码会先解码：用户名带空格/中文也能取到正确的目录名', () => {
  const entry =
    'file:///C:/Users/%E5%BC%A0%20san/AppData/Roaming/obox/extensions/rdp_chenzhi/index.js'
  assert.equal(
    appPageUrl(entry, { name: manifest.name, author: manifest.author }),
    'app://extensions/rdp_chenzhi/ui/index.html'
  )
})

test('调试目录名含非 ASCII 时按 URL 编码写进 app://（协议侧再解码）', () => {
  const entry = 'file:///D:/work/%E8%B0%83%E8%AF%95/rdp/index.js' // …/调试/rdp/
  assert.equal(
    appPageUrl(entry, { name: manifest.name, author: manifest.author }),
    `app://debug/${encodeURIComponent('rdp')}/ui/index.html`
  )
  const cjk = 'file:///D:/work/%E8%B0%83%E8%AF%95/index.js' // 目录名 = 调试
  assert.equal(
    appPageUrl(cjk, { name: manifest.name, author: manifest.author }),
    `app://debug/${encodeURIComponent('调试')}/ui/index.html`
  )
})

test('作者清洗后为空 ⇒ 目录名等于 name ⇒ 仍判成安装态（app://extensions/）', () => {
  const entry = 'file:///C:/a/userData/extensions/rdp/index.js'
  assert.equal(
    appPageUrl(entry, { name: 'rdp', author: '张三' }),
    'app://extensions/rdp/ui/index.html'
  )
})

test('page 参数：容忍 ./ 前缀、反斜杠；拒绝绝对路径 / .. / 空', () => {
  const opts = { name: manifest.name, author: manifest.author }
  const entry = 'file:///C:/a/extensions/rdp_chenzhi/index.js'
  assert.equal(
    appPageUrl(entry, { ...opts, page: './ui/index.html' }),
    'app://extensions/rdp_chenzhi/ui/index.html'
  )
  assert.equal(
    appPageUrl(entry, { ...opts, page: 'ui\\index.html' }),
    'app://extensions/rdp_chenzhi/ui/index.html'
  )
  assert.throws(() => appPageUrl(entry, { ...opts, page: '../index.js' }), /\.\./)
  assert.throws(() => appPageUrl(entry, { ...opts, page: '/abs/page.html' }), /绝对路径/)
  assert.throws(() => appPageUrl(entry, { ...opts, page: '  ' }), /不能为空/)
})

test('不支持的入口协议直接抛错（不静默给一个打不开的 URL）', () => {
  assert.throws(
    () => appPageUrl('https://example.com/index.js', { name: 'rdp' }),
    /不支持的入口 URL 协议/
  )
})

test('入口声明的 EXT_NAME / EXT_AUTHOR 与 manifest.json 逐字一致（页面 URL 的判据依赖它们）', () => {
  const source = readFileSync(join(root, 'index.js'), 'utf8')
  const nameMatch = /const EXT_NAME = '([^']*)'/.exec(source)
  const authorMatch = /const EXT_AUTHOR = '([^']*)'/.exec(source)
  assert.ok(nameMatch, 'index.js 应声明 EXT_NAME')
  assert.ok(authorMatch, 'index.js 应声明 EXT_AUTHOR')
  assert.equal(nameMatch[1], manifest.name, 'EXT_NAME 与 manifest.name 不一致')
  assert.equal(authorMatch[1], manifest.author, 'EXT_AUTHOR 与 manifest.author 不一致')
})
