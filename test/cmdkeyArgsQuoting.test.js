/**
 * cmdkey 值转义（真机实测约束）：含空白的值必须加引号、内部引号翻倍；
 * **绝不能**用 URL 编码之类的"看起来能过"的办法（会静默存进错误密码）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { quoteForCmdkey, storeCredentialArgs } from '../lib/cmdkeyArgs.mjs'

describe('quoteForCmdkey', () => {
  it('无空白：原样返回（不加引号）', () => {
    assert.equal(quoteForCmdkey('Simple123'), 'Simple123')
    assert.equal(quoteForCmdkey('p@ss!w0rd'), 'p@ss!w0rd')
  })

  it('含空格：整体加双引号（cmdkey 不这样就报缺少 /user:）', () => {
    assert.equal(quoteForCmdkey('pass word'), '"pass word"')
  })

  it('含双引号 + 空格：内部引号翻倍', () => {
    assert.equal(quoteForCmdkey('p@ss w"ord'), '"p@ss w""ord"')
  })

  it('空值与 undefined：空串', () => {
    assert.equal(quoteForCmdkey(''), '')
    assert.equal(quoteForCmdkey(undefined), '')
  })
})

describe('storeCredentialArgs 的转义', () => {
  it('普通密码：保持 /pass:<值> 形态', () => {
    const [a] = storeCredentialArgs({ host: 'h', username: 'u', password: 'Simple123' })
    assert.deepEqual(a.args, ['/generic:TERMSRV/h', '/user:u', '/pass:Simple123'])
  })

  it('含空格的密码：加引号（否则 cmdkey exit 1）', () => {
    const [a] = storeCredentialArgs({ host: 'h', username: 'u', password: 'pass word' })
    assert.equal(a.args[2], '/pass:"pass word"')
  })

  it('非默认端口：两个目标都带同样的转义', () => {
    const list = storeCredentialArgs({ host: 'h', port: 3399, username: 'u', password: 'a b' })
    assert.equal(list.length, 2)
    assert.deepEqual(
      list.map((x) => x.target),
      ['TERMSRV/h', 'TERMSRV/h:3399']
    )
    for (const x of list) assert.equal(x.args[2], '/pass:"a b"')
  })

  it('含域的用户名拼成 DOMAIN\\user，带空白时同样加引号', () => {
    const [a] = storeCredentialArgs({
      host: 'h',
      username: 'user name',
      domain: 'CORP',
      password: 'p'
    })
    assert.equal(a.args[1], '/user:"CORP\\user name"')
  })

  it('回归护栏：密码绝不能被 URL 编码或反斜杠转义（会静默存错密码）', () => {
    const [a] = storeCredentialArgs({ host: 'h', username: 'u', password: 'pass word' })
    assert.ok(!a.args[2].includes('%20'), '/pass 不得出现 %20')
    assert.ok(!a.args[2].includes('\\ '), '/pass 不得用反斜杠转义空格')
    assert.equal(a.args[2], '/pass:"pass word"')
  })
})
