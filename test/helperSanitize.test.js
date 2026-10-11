/**
 * cmdkey 失败的错误文本必须脱敏。
 *
 * 背景（阶段七审视发现的高危）：`execFile` 失败时 `err.message` 是
 * `Command failed: cmdkey … /pass:<明文>`，而 stderr 常为空——这些串经 index.js 的 warnings
 * 进界面状态栏、也进 console.error，等于把密码明文写进 UI 与日志。
 *
 * 这里用**制表符密码**逼出真实失败（实测 cmdkey 对含 tab 的 `/pass:` 一定 exit 1），
 * 断言返回文本里 `/pass:` 的值被打码、且原密码不出现。
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const helper = join(here, '..', 'helper.cjs')
const workDir = join(tmpdir(), `obox-rdp-sanitize-${process.pid}-${Date.now()}`)
const SECRET = 'Tab\tSecret42'

let child
let buf = ''
const pending = new Map()

function call(id, method, params) {
  return new Promise((resolve, reject) => {
    pending.set(id, resolve)
    setTimeout(() => reject(new Error('timeout')), 30000)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

before(async () => {
  mkdirSync(join(workDir, 'data'), { recursive: true })
  child = spawn(process.execPath, [helper], {
    cwd: join(workDir, 'data'),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdout.on('data', (d) => {
    buf += d.toString()
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('{')) continue
      const msg = JSON.parse(line)
      const r = pending.get(msg.id)
      if (r) {
        pending.delete(msg.id)
        r(msg)
      }
    }
  })
  await new Promise((r) => setTimeout(r, 400))
})

after(async () => {
  child?.kill()
  await new Promise((r) => setTimeout(r, 300))
  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    // Windows 上子进程刚退出时其 cwd 可能仍被占用（EPERM）；临时目录交给系统清理即可
  }
})

describe('helper 的 cmdkey 错误文本脱敏', () => {
  it('cmdkey 失败时回传的 error 里密码被打码，且原密码不出现', async () => {
    const res = await call(1, 'storeCredential', {
      host: '127.0.0.1',
      port: 3389,
      user: 'probe',
      pass: SECRET
    })
    const text = JSON.stringify(res)
    assert.ok(!text.includes(SECRET), `错误文本里不应出现原密码：${text.slice(0, 300)}`)
    assert.ok(!text.includes('Tab\tSecret42'), '错误文本里不应出现原密码（tab 形态）')
    // 要么成功（某些 cmdkey 版本容忍 tab），要么失败但已打码
    if (res.result && res.result.results) {
      const failed = res.result.results.filter((x) => !x.ok)
      for (const f of failed) {
        assert.ok(f.error.includes('/pass:***'), `失败项应打码：${f.error}`)
      }
    }
  })
})
