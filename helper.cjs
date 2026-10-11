#!/usr/bin/env node
'use strict'
/**
 * RDP 助手（纯 Node，随扩展包分发；宿主经 `api.ipc` 的 stdio 通道拉起）。
 *
 * 协议：**JSON-RPC 2.0**，分帧 `ndjson`（一行一条 JSON）。
 *   ← 请求  {"jsonrpc":"2.0","id":1,"method":"probe","params":{}}
 *   → 响应  {"jsonrpc":"2.0","id":1,"result":{…}}
 *           {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"…"}}
 *
 * ⚠️ 与设计文档 §3.3 的简写（`{id,method,params}` / `{id,ok,result|error}`）**不一致**：
 * 宿主 `src/main/ipcCore.ts:496` 强制要求 `jsonrpc: "2.0"`，否则通道立刻以
 * `protocol-error 缺少 jsonrpc: "2.0"` 关闭。因此这里实现标准 JSON-RPC 2.0
 * （设计 §2 的 D5 一栏也写的正是 "JSON-RPC over stdio"）。
 *
 * 日志一律走 **stderr**（宿主转发到输出通道）；**stdout 只放协议帧**，多一个字符都会毁掉分帧。
 * 方法：storeCredential / deleteCredential / launch / probe；另有 `--selftest`（不调 cmdkey/mstsc）。
 */
const { execFile, spawn } = require('node:child_process')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const readline = require('node:readline')

/** cmdkey 单次调用超时（毫秒）——凭据写入是本地操作，超时只可能是环境异常 */
const CMDKEY_TIMEOUT_MS = 15_000
/** JSON-RPC 标准错误码 */
const RPC_PARSE_ERROR = -32700
const RPC_INVALID_PARAMS = -32602
const RPC_METHOD_NOT_FOUND = -32601
const RPC_INTERNAL_ERROR = -32603

/** lib/cmdkeyArgs.mjs 的绝对 URL（helper 可能以任意 cwd 启动，不能依赖相对解析） */
const CMDKEY_ARGS_URL = pathToFileURL(join(__dirname, 'lib', 'cmdkeyArgs.mjs')).href

/** 惰性加载纯模块（CJS 不能静态 import ESM；用绝对 URL 避免 cwd 影响） */
let cmdkeyArgsModule = null
async function cmdkeyArgs() {
  if (!cmdkeyArgsModule) cmdkeyArgsModule = await import(CMDKEY_ARGS_URL)
  return cmdkeyArgsModule
}

/** 换行统一成 CRLF（`.rdp` 要求 CRLF；已经是 CRLF 的不重复叠加） */
function toCrlf(text) {
  return String(text ?? '').replace(/\r\n|\r|\n/g, '\r\n')
}

/** 文件名白名单：只能是单段文件名（防目录穿越），非空 */
function assertFileName(fileName) {
  const name = String(fileName ?? '').trim()
  if (!name) throw new Error('launch 需要 fileName')
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`fileName 非法（只能是文件名，不能含路径）: ${name}`)
  }
  return name
}

/**
 * 执行一次 cmdkey，返回 {ok, stdout, stderr, error}（不抛错，由调用方判定）。
 *
 * `windowsVerbatimArguments: true` 是**必须的**：Node 在 Windows 上默认会按"标准命令行解析器"
 * 再替我们转义一遍参数（给含空格的值加引号、把内部引号改成反斜杠转义），而 cmdkey 用的是它自己的
 * 土解析器——实测同一组参数在 PowerShell 里能成功、经 execFile 默认转义后却报
 * "requires either the /U switch and a username"。传 true 表示"参数已由我们拼好，原样传"，
 * 配合 lib/cmdkeyArgs.mjs 的 quoteForCmdkey 才能被 cmdkey 正确解析。
 */
/**
 * 脱敏 cmdkey 的错误/输出文本。
 *
 * **必须做**：`execFile` 失败时 `err.message` 是 `Command failed: cmdkey … /pass:<明文>`（实测 stderr
 * 常为空、密码只出现在 `err.message` 里）。这些串会经 `index.js` 的 warnings 进界面状态栏、也会进
 * `console.error`，等于把密码明文写进 UI 与日志。所有对外文本一律先过这里。
 */
function sanitizeCmdkeyText(text) {
  return String(text ?? '').replace(/\/pass:\S+/gi, '/pass:***')
}

function runCmdkey(args) {
  return new Promise((resolve) => {
    execFile(
      'cmdkey',
      args,
      { timeout: CMDKEY_TIMEOUT_MS, windowsHide: true, windowsVerbatimArguments: true },
      (err, stdout, stderr) => {
        const out = sanitizeCmdkeyText(String(stdout ?? '').trim())
        const errOut = sanitizeCmdkeyText(String(stderr ?? '').trim())
        if (err) {
          resolve({
            ok: false,
            stdout: out,
            stderr: errOut,
            error: err.killed
              ? `cmdkey 超时（${CMDKEY_TIMEOUT_MS}ms）`
              : errOut || sanitizeCmdkeyText(err.message)
          })
          return
        }
        resolve({ ok: true, stdout: out, stderr: errOut, error: '' })
      }
    )
  })
}

/**
 * 写 `<dir>/rdp/<fileName>`：UTF-8 + CRLF，目录不存在则递归创建（每次覆盖写）。
 * @returns {Promise<string>} 落盘绝对路径
 */
async function writeRdpFile(dir, fileName, rdpText) {
  const name = assertFileName(fileName)
  const targetDir = join(dir, 'rdp')
  await mkdir(targetDir, { recursive: true })
  const filePath = join(targetDir, name)
  await writeFile(filePath, toCrlf(rdpText), 'utf8')
  return filePath
}

/** `storeCredential {host,port,user,pass,domain}`：逐条写 TERMSRV 目标串（见 cmdkeyArgs.mjs） */
async function storeCredential(params = {}) {
  const { storeCredentialArgs } = await cmdkeyArgs()
  const rows = storeCredentialArgs({
    host: params.host,
    port: params.port,
    username: params.user,
    password: params.pass,
    domain: params.domain
  })
  const results = []
  for (const row of rows) {
    const r = await runCmdkey(row.args)
    results.push({ target: row.target, ok: r.ok, error: r.error })
  }
  const failed = results.filter((r) => !r.ok)
  if (failed.length === results.length) {
    throw new Error(`cmdkey 保存凭据失败（${failed[0].target}）：${failed[0].error}`)
  }
  // 部分成功（例如两条目标串只成功一条）不算失败，交给调用方按 warnings 提示
  return { targets: results.map((r) => r.target), results }
}

/**
 * `deleteCredential {host,port}`：逐条删（"两条都试"）。
 * **缺条目不算失败**：cmdkey 对不存在的条目会报错，这里只汇总成 warnings 返回。
 */
async function deleteCredential(params = {}) {
  const { deleteCredentialArgs } = await cmdkeyArgs()
  const rows = deleteCredentialArgs({ host: params.host, port: params.port })
  const warnings = []
  const deleted = []
  for (const row of rows) {
    const r = await runCmdkey(row.args)
    if (r.ok) deleted.push(row.target)
    else warnings.push(`${row.target}: ${r.error}`)
  }
  return { deleted, warnings }
}

/**
 * `launch {rdpText,fileName,credential}`：
 * 按需预置凭据 → 写 `<cwd>/rdp/<fileName>` → `spawn('mstsc.exe',[rdpPath])` detached 并 unref。
 * 返回 `{pid}`（另附 `warnings` 与 `path`：凭据写入失败不阻断打开，但要能提示用户）。
 */
async function launch(params = {}) {
  const warnings = []
  if (params.credential && params.credential.pass) {
    try {
      const r = await storeCredential(params.credential)
      for (const item of r.results) {
        if (!item.ok) warnings.push(`凭据可能未保存（${item.target}）：${item.error}`)
      }
    } catch (err) {
      warnings.push(`凭据未保存，连接时可能要求输入密码：${err.message}`)
    }
  }

  const rdpPath = await writeRdpFile(process.cwd(), params.fileName, params.rdpText)
  const child = spawn('mstsc.exe', [rdpPath], { detached: true, stdio: 'ignore' })
  const pid = await new Promise((resolve, reject) => {
    child.once('spawn', () => resolve(child.pid))
    child.once('error', (err) => reject(new Error(`启动 mstsc.exe 失败：${err.message}`)))
  })
  child.unref()
  return { pid, path: rdpPath, warnings }
}

/** `probe`：环境诊断（界面「环境检查」用；设计 §3.3） */
function probe() {
  return {
    cwd: process.cwd(),
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null
  }
}

/** 方法表 */
const METHODS = {
  storeCredential,
  deleteCredential,
  launch,
  probe
}

/** 一行 → 一行响应（stdout 只写协议帧） */
function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function handleLine(line) {
  const text = String(line ?? '').trim()
  if (!text) return

  let request
  try {
    request = JSON.parse(text)
  } catch (err) {
    writeMessage({
      jsonrpc: '2.0',
      id: null,
      error: { code: RPC_PARSE_ERROR, message: `请求不是合法 JSON: ${err.message}` }
    })
    return
  }

  const id = request && request.id !== undefined ? request.id : undefined
  if (id === undefined) return // 通知（如宿主的 $/cancelRequest）：无需应答

  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: RPC_INVALID_PARAMS, message: '请求必须是 {jsonrpc:"2.0",id,method,params}' }
    })
    return
  }

  const handler = METHODS[request.method]
  if (!handler) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: RPC_METHOD_NOT_FOUND, message: `未知方法: ${request.method}` }
    })
    return
  }

  try {
    const result = await handler(request.params)
    writeMessage({ jsonrpc: '2.0', id, result: result ?? null })
  } catch (err) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: RPC_INTERNAL_ERROR, message: err instanceof Error ? err.message : String(err) }
    })
  }
}

/** 协议循环：stdin 一行一请求（CRLF 容忍），stdin 结束即退出 */
function serve() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on('line', (line) => {
    void handleLine(line)
  })
  rl.on('close', () => process.exit(0))
  process.stderr.write(`[rdp-helper] 就绪 cwd=${process.cwd()} node=${process.versions.node}\n`)
}

/** 自测样例：非默认端口 + 中文值 + 非默认开关（不调 cmdkey/mstsc） */
const SAMPLE_RDP = [
  'full address:s:10.0.0.8:13389',
  'username:s:测试用户',
  'domain:s:CORP',
  'screen mode id:i:2',
  'desktopwidth:i:1920',
  'drivestoredirect:s:C:\\;E:\\;',
  ''
].join('\r\n')

/**
 * `--selftest`：写一份样例 `.rdp` 到临时目录并回读断言，**不调 cmdkey / mstsc**。
 * @returns {Promise<number>} 退出码 0/1
 */
async function selftest() {
  const dir = await mkdtemp(join(tmpdir(), 'obox-rdp-selftest-'))
  try {
    const filePath = await writeRdpFile(dir, '1.rdp', SAMPLE_RDP)
    const text = await readFile(filePath, 'utf8')

    assert.ok(text.startsWith('full address:s:10.0.0.8:13389\r\n'), '首行应为 full address')
    assert.ok(text.includes('username:s:测试用户\r\n'), 'UTF-8 中文用户名应原样往返')
    assert.ok(text.includes('domain:s:CORP\r\n'), 'domain 行缺失')
    assert.ok(text.includes('drivestoredirect:s:C:\\;E:\\;\r\n'), '反斜杠应字面保留')
    assert.ok(text.endsWith('\r\n'), '末尾应有 CRLF')
    assert.ok(text.includes('\r\n'), '行尾应为 CRLF')
    assert.ok(!/(^|[^\r])\n/.test(text), '不应出现裸 LF')
    assert.ok(!text.includes('password 51:b:'), '绝不写 password 51:b:')
    assert.ok(!text.startsWith('\uFEFF'), '不应带 BOM')

    // 目录自动创建 + 覆盖写：同一 id 再写一次，内容应被替换
    const again = await writeRdpFile(dir, '2.rdp', 'full address:s:127.0.0.1\r\n')
    assert.equal(await readFile(again, 'utf8'), 'full address:s:127.0.0.1\r\n')
    // 文件名防护
    assert.throws(() => assertFileName('../escape.rdp'), /fileName 非法/)
    assert.throws(() => assertFileName('a/b.rdp'), /fileName 非法/)

    console.log(`[rdp-helper] selftest 通过（临时目录 ${dir}，未调用 cmdkey/mstsc）`)
    return 0
  } catch (err) {
    console.error(`[rdp-helper] selftest 失败：${err instanceof Error ? err.message : String(err)}`)
    return 1
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function main() {
  if (process.argv.includes('--selftest')) {
    process.exitCode = await selftest()
    return
  }
  serve()
}

void main()
