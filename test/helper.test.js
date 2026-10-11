/**
 * `helper.cjs` 集成测试：
 * - `--selftest`（写样例 .rdp + 回读断言，退出码 0；**不调 cmdkey/mstsc**）
 * - 真实子进程上的 ndjson 往返（probe / 未知方法 / 非法形状 / fileName 防护）
 *
 * 这里把"协议形状"钉死：宿主 `src/main/ipcCore.ts` 强制要求 `jsonrpc:"2.0"`，
 * 缺了会立刻以 protocol-error 关通道——因此断言里明确校验这一字段。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

const helperPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'helper.cjs')
const nodePath = process.execPath

/** 跑一次 `node helper.cjs --selftest`，收集输出与退出码 */
function runSelftest() {
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, [helperPath, '--selftest'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

test('helper.cjs --selftest 通过且退出码为 0', async () => {
  const r = await runSelftest()
  assert.equal(r.code, 0, `退出码 ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`)
  assert.match(r.stdout, /selftest 通过/)
})

test('helper.cjs 的 ndjson JSON-RPC 往返（probe / 错误形状 / fileName 防护）', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'obox-rdp-helper-test-'))
  const child = spawn(nodePath, [helperPath], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  const responses = []
  let stderr = ''
  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    const text = String(line).trim()
    if (text) responses.push(JSON.parse(text))
  })
  child.stderr.on('data', (chunk) => (stderr += chunk))

  /** 等一条满足条件的响应（最长 10s） */
  const waitFor = (predicate) =>
    new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const found = responses.find(predicate)
        if (found) {
          clearInterval(timer)
          resolve(found)
        } else if (Date.now() - started > 10_000) {
          clearInterval(timer)
          reject(new Error(`等待响应超时；已收到 ${JSON.stringify(responses)}；stderr: ${stderr}`))
        }
      }, 20)
    })

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)

  try {
    // 1) probe：明文 JSON-RPC 2.0 请求 → result
    send({ jsonrpc: '2.0', id: 1, method: 'probe', params: {} })
    const probe = await waitFor((r) => r.id === 1)
    assert.equal(probe.jsonrpc, '2.0')
    assert.equal(probe.error, undefined)
    assert.equal(basename(probe.result.cwd), basename(cwd), 'cwd 应继承宿主的 data 目录')
    assert.ok(probe.result.node, 'probe 应返回 node 版本')
    assert.ok('electron' in probe.result)
    assert.ok('runAsNode' in probe.result)

    // 2) 未知方法 → -32601
    send({ jsonrpc: '2.0', id: 2, method: 'nope', params: {} })
    const unknown = await waitFor((r) => r.id === 2)
    assert.equal(unknown.result, undefined)
    assert.equal(unknown.error.code, -32601)
    assert.match(unknown.error.message, /未知方法: nope/)

    // 3) 缺 jsonrpc 的简写形状（设计 §3.3 的写法）必须被拒——宿主只认 JSON-RPC 2.0
    send({ id: 3, method: 'probe', params: {} })
    const shorthand = await waitFor((r) => r.id === 3)
    assert.equal(shorthand.error.code, -32602)

    // 4) 非法 JSON → -32700（id 为 null）
    child.stdin.write('{not json}\n')
    const broken = await waitFor((r) => r.id === null)
    assert.equal(broken.error.code, -32700)

    // 5) fileName 不能带路径（不写文件、不碰 mstsc）
    send({
      jsonrpc: '2.0',
      id: 4,
      method: 'launch',
      params: { rdpText: 'x', fileName: '../evil.rdp' }
    })
    const evil = await waitFor((r) => r.id === 4)
    assert.equal(evil.error.code, -32603)
    assert.match(evil.error.message, /fileName 非法/)
    await assert.rejects(() => rm(join(cwd, '..', 'evil.rdp'), { force: false }))
  } finally {
    child.stdin.end()
    const code = await new Promise((resolve) => child.on('close', resolve))
    assert.equal(code, 0, `stdin 关闭后助手应自行退出（stderr: ${stderr}）`)
    await rm(cwd, { recursive: true, force: true })
  }
})
