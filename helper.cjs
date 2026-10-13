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
 * `launch` 不直接 spawn mstsc，而是经 **`cmd /c start`** 派发（让 mstsc 脱离 obox 进程树），
 * 取舍与实测见 `docs/adr/0003-mstsc-orphan-launch-via-cmd.md`。
 */
const { execFile, spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const readline = require('node:readline')

/** cmdkey 单次调用超时（毫秒）——凭据写入是本地操作，超时只可能是环境异常 */
const CMDKEY_TIMEOUT_MS = 15_000
/**
 * `cmd /c start` 派发的兜底超时（毫秒）。
 *
 * 真机实测 `cmd` 派发 mstsc 后 **49–905ms** 就自己退出（905ms 是 30 层深路径的最坏观测值），
 * 15s 是 16× 余量。必须要有兜底：`start` 的**目标程序名解析失败**时它会弹"选择打开方式"对话框
 * 并**挂住 cmd 不退出**（实测 ≥8s 不退），没有超时就会留下僵尸 cmd + 一个永不返回的 IPC 调用
 * （宿主 60s 后报 timeout，用户看到的是转圈）。见 docs/adr/0003。
 */
const START_TIMEOUT_MS = 15_000
/** JSON-RPC 标准错误码 */
const RPC_PARSE_ERROR = -32700
const RPC_INVALID_PARAMS = -32602
const RPC_METHOD_NOT_FOUND = -32601
const RPC_INTERNAL_ERROR = -32603

/** lib/cmdkeyArgs.mjs 的绝对 URL（helper 可能以任意 cwd 启动，不能依赖相对解析） */
const CMDKEY_ARGS_URL = pathToFileURL(join(__dirname, 'lib', 'cmdkeyArgs.mjs')).href
/** lib/mstscArgs.mjs 的绝对 URL（同上；`cmd /c start` 的参数数组与 mstsc 路径解析） */
const MSTSC_ARGS_URL = pathToFileURL(join(__dirname, 'lib', 'mstscArgs.mjs')).href

/** 惰性加载纯模块（CJS 不能静态 import ESM；用绝对 URL 避免 cwd 影响） */
let cmdkeyArgsModule = null
async function cmdkeyArgs() {
  if (!cmdkeyArgsModule) cmdkeyArgsModule = await import(CMDKEY_ARGS_URL)
  return cmdkeyArgsModule
}

/** 同上，惰性加载 `lib/mstscArgs.mjs` */
let mstscArgsModule = null
async function mstscArgs() {
  if (!mstscArgsModule) mstscArgsModule = await import(MSTSC_ARGS_URL)
  return mstscArgsModule
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
 * 常为空、密码只出现在 `err.message` 里）。这些串会经 `index.js` 的 warnings 进控制台日志
 * （`console.info`/`console.error`，前缀 `[rdp]`；界面自 1.0.3 起不再显示任何提示），
 * 等于把密码明文写进日志。所有对外文本一律先过这里。
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
 * 派发 `cmd /c start "" <mstsc> "<.rdp>"` 并等 `cmd` 退出。**退出码 0 即成功**。
 *
 * ⚠️ `windowsVerbatimArguments: false` 是**刻意的、且与同文件 `runCmdkey` 的 `true` 相反**：
 *   - `cmdkey` 用的是**它自己的土解析器**，所以那一边必须传 `true`（参数我们自己拼好、原样传）；
 *   - `cmd.exe` 用的是**标准命令行解析器**，Node 在 `false` 下的转义（含空白的参数整体加引号）
 *     正是我们要的。改成 `true` 后，`C:\obox probe\1.rdp` 会在空格处被 `start` 拆成两个 token，
 *     而 `cmd` **仍然 exit 0** ⇒ 静默走错（单测全绿也发现不了，因为单测不启动真 cmd）。
 * 理由与真机实测见 `lib/mstscArgs.mjs` 文件头、`docs/adr/0003`、README §9 第 2 条。
 *
 * 继承既有语义：`detached: true`（助手若在 cmd 退出前被杀也不连带终止它）、`stdio: 'ignore'`
 * （不需要 cmd 的输出，错误从退出码/error 事件来）、`windowsHide: true`（cmd 是控制台程序，
 * 别让窗口闪一下）。`shell` 不设：我们自己就是 `cmd.exe`，再加一层只会多一层解析。
 *
 * @param {string[]} args `buildStartArgs()` 的产物（恰好 5 个元素）
 * @returns {Promise<void>} 成功（退出码 0）时 resolve
 */
function startViaCmd(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', args, {
      windowsVerbatimArguments: false, // 见上：不要照抄 runCmdkey 的 true
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill() // 不留僵尸 cmd（`start` 目标不存在时会挂住不退）
      reject(new Error(`启动 mstsc.exe 超时（${START_TIMEOUT_MS}ms 未返回）`))
    }, START_TIMEOUT_MS)

    child.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`启动 mstsc.exe 失败：${err.message}`))
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }
      if (code === null) {
        reject(new Error(`启动 mstsc.exe 失败：cmd 被信号 ${signal ?? '未知'} 终止`))
        return
      }
      reject(new Error(`启动 mstsc.exe 失败：cmd 退出码 ${code}`))
    })
    child.unref()
  })
}

/**
 * `launch {rdpText,fileName,credential}`：
 * 按需预置凭据 → 解析 mstsc 绝对路径并**先做两项前置校验**（mstsc 存在、路径可安全派发）
 * → 写 `<cwd>/rdp/<fileName>` → `spawn('cmd.exe', ['/c','start','',mstsc,rdpPath])` 并等 `cmd` 退出码 0
 * → 返回 `{ pid: null, path, warnings }`。
 *
 * `pid` **恒为 null**：经 `cmd /c start` 派发后 mstsc 不是我们的子进程，拿不到 pid；字段保留只是
 * 为了不改既有契约（阶段 1 已关闭的 Q2）。**代价**：`cmd` 退出码 0 只证明"命令已派发"，
 * **不证明 mstsc 真的起来了**（真机实测：`.rdp` 指向不存在的盘时 `cmd` 仍 exit 0，由 mstsc
 * 自己弹框）——所以调用方的文案只能写"已通过 shell 打开"，不能写"已连上"。
 *
 * 前置校验写在写文件**之前**：这样"没有 mstsc"与"路径含 %VAR%"两种情况不会留下半个 `.rdp`
 * 文件。而 `cmd` 失败（非 0/超时）时文件**已经写了**——与现状"先写后 spawn"一致，属既有语义。
 *
 * 完整取舍（含被否决的 WMI / explorer 方案与回退动作）见 `docs/adr/0003-mstsc-orphan-launch-via-cmd.md`。
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

  // ① 目标程序必须先存在：`start` 解析不到程序名时会弹框并挂住 cmd，靠 15s 超时兜太晚也太吵
  const { buildStartArgs, resolveMstscPath } = await mstscArgs()
  const mstscExePath = resolveMstscPath()
  if (!existsSync(mstscExePath)) {
    throw new Error(`未找到 mstsc.exe（远程桌面客户端）：${mstscExePath}`)
  }

  // ② 路径护栏（含 %VAR% / 引号 / 换行 ⇒ 在这里就抛，不写文件）
  const fileName = assertFileName(params.fileName)
  const rdpPath = join(process.cwd(), 'rdp', fileName)
  const args = buildStartArgs(mstscExePath, rdpPath)

  // ③ 覆盖写 `.rdp`（逻辑不变）→ ④ 经 cmd 派发并等退出码
  await writeRdpFile(process.cwd(), fileName, params.rdpText)
  await startViaCmd(args)
  return { pid: null, path: rdpPath, warnings }
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

    // cmd 命令行构造的纯函数矩阵（同样**不**启动 cmd/mstsc：真启动会让 --selftest 从"纯自测"
    // 变成"会弹窗的测试"，与它的既有契约相冲；真机语义属人工验收）
    const { buildStartArgs, resolveMstscPath } = await mstscArgs()
    const mstsc = resolveMstscPath({ SystemRoot: 'C:\\WINDOWS' })
    assert.equal(mstsc, 'C:\\WINDOWS\\System32\\mstsc.exe', 'mstsc 路径应由 SystemRoot 拼出')
    for (const p of [
      'C:\\obox probe\\1.rdp',
      'C:\\会话 #1.rdp',
      'C:\\a&b\\1.rdp',
      'C:\\a^b\\1.rdp',
      'C:\\(a) b\\1.rdp',
      'C:\\a!b\\1.rdp',
      'C:\\100% done\\1.rdp'
    ]) {
      const args = buildStartArgs(mstsc, p)
      assert.equal(args.length, 5, 'cmd 参数必须是 5 个')
      assert.equal(args[2], '', 'start 的空标题占位不能丢')
      assert.equal(args[4], p, '路径必须原样传（不加引号/不转义）')
    }
    assert.throws(() => buildStartArgs(mstsc, 'C:\\%TEMP%\\1.rdp'), /含 %/)
    assert.throws(() => buildStartArgs(mstsc, 'C:\\a"b\\1.rdp'), /引号或换行/)

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
