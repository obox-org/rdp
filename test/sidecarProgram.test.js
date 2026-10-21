/**
 * **sidecar 专项门禁**（obox 2.0.0 宿主模式适配）：`contributes.ipcChannels` 的声明、`program`
 * 的解析基准、以及"宿主里 cwd 变成扩展 data 目录"会不会影响本扩展的 helper。
 *
 * 事实来源（宿主实现，扩展侧只能订阅不能改）：
 * - `src/extension-host/capabilities/ipc.ts`：`resolveProgramInExtension(extensionDir, program)`
 *   ⇒ `program` 相对**扩展目录**解析（越界报 `invalid-declaration`）；
 * - 同文件 `buildTransportFactory`：spawn 时 `cwd = dataDir`（= `<扩展目录>/data`）、
 *   `.js/.cjs/.mjs` 用宿主自带 Node 跑并注入 `ELECTRON_RUN_AS_NODE=1`；
 * - `src/main/ipcCore.ts` 的 `resolveStdioSpawn`：同一份实现，主进程模式与宿主模式一致。
 *
 * 因此这里钉三件事：
 * 1. 清单声明与宿主规则**同时成立**（program 是相对路径、不越界、解析后真实存在）；
 * 2. helper 的 `lib/*.mjs` 走 `__dirname` 绝对 URL 加载 ⇒ **与 cwd 无关**（在陌生 cwd 下也能跑）；
 * 3. helper 写 `.rdp` 用的是 `process.cwd()`（= 宿主给的 data 目录）⇒ 落点不随宿主/主进程而变。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
const helperPath = join(root, 'helper.cjs')
const helperSource = readFileSync(helperPath, 'utf8')

/** 清单里声明的 stdio 通道（本扩展只有一个） */
const channel = manifest.contributes?.ipcChannels?.[0]

test('清单声明：rdp.helper / stdio / ndjson / 相对 program', () => {
  assert.ok(channel, 'manifest 应声明 contributes.ipcChannels')
  assert.equal(channel.id, 'rdp.helper')
  assert.equal(channel.transport, 'stdio')
  // ndjson（每行一条）⇒ 不涉及 Content-Length，天然规避"按字符数算长度"的吞帧坑
  assert.equal(channel.framing, 'ndjson')
  assert.equal(channel.program, './helper.cjs')
})

test('program 按宿主规则（相对扩展目录解析）成立，且没有任何绝对路径/越界写法', () => {
  // ① 与宿主 validateIpcDeclaration 同口径：归一化后不得是绝对路径、不得含 ..
  const normalized = channel.program.replace(/\\/g, '/').replace(/^\.\//, '')
  assert.ok(!normalized.startsWith('/'), 'program 不得以 / 开头')
  assert.ok(!/^[A-Za-z]:/.test(normalized), 'program 不得带盘符')
  assert.ok(!normalized.split('/').includes('..'), 'program 不得含 ..')
  assert.equal(isAbsolute(channel.program), false, 'program 必须是相对路径')

  // ② 与宿主 resolveProgramInExtension 同口径：以扩展目录为基准解析
  const resolved = resolve(root, channel.program)
  assert.equal(resolved, helperPath, 'program 应解析到扩展目录下的 helper.cjs')
  assert.ok(existsSync(resolved), '解析结果必须真实存在')
  assert.equal(readFileSync(resolved, 'utf8'), helperSource)

  // ③ 与 cwd 无关：解析结果不在"某个工作的目录"里推导，而只由扩展目录决定
  assert.equal(resolve('C:\\whatever\\data', channel.program) === resolved, false)
})

test('helper 用 __dirname 绝对 URL 加载 lib/*.mjs（不依赖 cwd），也不自带 Content-Length 分帧', () => {
  // 两条 lib 依赖都必须走 `pathToFileURL(join(__dirname, 'lib', …))`
  const dirnameUrls = helperSource.match(/pathToFileURL\(join\(__dirname, 'lib'/g) ?? []
  assert.equal(dirnameUrls.length, 2, `应有两处 __dirname 绝对 URL（实际 ${dirnameUrls.length}）`)
  // 反例护栏：不得出现"相对 cwd/相对路径"的 lib 加载
  assert.ok(!/require\((['"])\.\/lib\//.test(helperSource), '不得用相对路径 require lib/')
  assert.ok(!/await import\((['"])\.\/lib\//.test(helperSource), '不得用相对路径 import lib/')
  // 分帧：只按行（ndjson），不自己算 Content-Length
  assert.ok(!/Content-Length/i.test(helperSource), 'helper 不该实现 Content-Length 分帧')
  assert.match(helperSource, /process\.stdout\.write\(`\$\{JSON\.stringify\(message\)\}\\n`\)/)
  assert.match(helperSource, /readline\.createInterface\(\{ input: process\.stdin/)
})

test('helper 把 .rdp 写到 process.cwd()（= 宿主给的 data 目录），不写扩展目录', () => {
  // 落点由宿主 spawn 时的 cwd 决定（`<扩展目录>/data`），这句话就是契约本身：
  // 两种模式下 cwd 都是 `<扩展目录>/data`，所以升级/迁移不改变 `.rdp` 的位置。
  assert.match(helperSource, /join\(process\.cwd\(\), 'rdp', fileName\)/)
  assert.match(helperSource, /writeRdpFile\(process\.cwd\(\), fileName, params\.rdpText\)/)
  // 反例护栏：不得改成 __dirname/扩展目录相对（那会让"清理 data 目录"漏掉这些临时文件）
  assert.ok(!/writeRdpFile\(__dirname/.test(helperSource))
})

test('--selftest 在"陌生 cwd"下也通过（lib 加载与写盘都不依赖 cwd）', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'obox-rdp-sidecar-cwd-'))
  try {
    const result = await new Promise((resolvePromise, rejectPromise) => {
      // 宿主用 `ELECTRON_RUN_AS_NODE=1` + 自带 Node 跑 .cjs；单测里用当前 Node 等价模拟
      const child = spawn(process.execPath, [helperPath, '--selftest'], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('error', rejectPromise)
      child.on('close', (code) => resolvePromise({ code, stdout, stderr }))
    })
    assert.equal(
      result.code,
      0,
      `退出码 ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    )
    assert.match(result.stdout, /selftest 通过/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('宿主 spawn 契约：cwd 由宿主给（data 目录），helper 如实回报该 cwd', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'obox-rdp-sidecar-data-'))
  const child = spawn(process.execPath, [helperPath], {
    cwd: dataDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const responses = []
  let stderr = ''
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    const text = String(line).trim()
    if (text) responses.push(JSON.parse(text))
  })

  const waitFor = (predicate) =>
    new Promise((resolvePromise, rejectPromise) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const found = responses.find(predicate)
        if (found) {
          clearInterval(timer)
          resolvePromise(found)
        } else if (Date.now() - started > 10_000) {
          clearInterval(timer)
          rejectPromise(new Error(`等待响应超时；stderr: ${stderr}`))
        }
      }, 20)
    })

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'probe', params: {} })}\n`)
    const probe = await waitFor((r) => r.id === 1)
    assert.equal(probe.error, undefined, JSON.stringify(probe.error))
    // 宿主里 cwd 是 `<扩展目录>/data`；helper 不假设它是扩展目录，也不假设它是某个固定路径
    assert.equal(
      resolve(probe.result.cwd),
      resolve(dataDir),
      'helper 的 cwd 应就是宿主给的那个目录'
    )
    assert.ok(
      !existsSync(join(dataDir, 'lib')),
      'data 目录下没有 lib/（证明 lib 不是因为 cwd 才找到的）'
    )
  } finally {
    child.stdin.end()
    const code = await new Promise((resolvePromise) => child.on('close', resolvePromise))
    assert.equal(code, 0)
    await rm(dataDir, { recursive: true, force: true })
  }
})
