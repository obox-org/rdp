/**
 * `lib/cmdkeyArgs.mjs` 单测：目标串两条策略、域拼接、参数形状。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  credentialTargets,
  credentialUser,
  deleteCredentialArgs,
  storeCredentialArgs
} from '../lib/cmdkeyArgs.mjs'

test('默认端口只写一条目标串', () => {
  assert.deepEqual(credentialTargets('10.0.0.8', 3389), ['TERMSRV/10.0.0.8'])
  assert.deepEqual(credentialTargets('10.0.0.8'), ['TERMSRV/10.0.0.8'])
  assert.deepEqual(credentialTargets('10.0.0.8', ''), ['TERMSRV/10.0.0.8'])
  assert.deepEqual(credentialTargets('10.0.0.8', '3389'), ['TERMSRV/10.0.0.8'])
})

test('非默认端口两条都写（官方未确认 → 两条并试）', () => {
  assert.deepEqual(credentialTargets('win-srv', 13389), [
    'TERMSRV/win-srv',
    'TERMSRV/win-srv:13389'
  ])
  assert.deepEqual(credentialTargets('10.0.0.8', '13389'), [
    'TERMSRV/10.0.0.8',
    'TERMSRV/10.0.0.8:13389'
  ])
})

test('目标串主机去空白；空主机抛错', () => {
  assert.deepEqual(credentialTargets('  win-srv  ', 3389), ['TERMSRV/win-srv'])
  assert.throws(() => credentialTargets('', 3389), /非空主机/)
  assert.throws(() => credentialTargets('   ', 3389), /非空主机/)
  assert.throws(() => credentialTargets(undefined, 3389), /非空主机/)
})

test('域拼接：有域写 DOMAIN\\user，无域原样', () => {
  assert.equal(credentialUser('chenzhi', 'CORP'), 'CORP\\chenzhi')
  assert.equal(credentialUser('chenzhi', ''), 'chenzhi')
  assert.equal(credentialUser('chenzhi', '  '), 'chenzhi')
  assert.equal(credentialUser('  chenzhi ', ' CORP '), 'CORP\\chenzhi')
})

test('storeCredentialArgs：/generic + /user + /pass，逐目标一条', () => {
  const rows = storeCredentialArgs({
    host: '10.0.0.8',
    port: 3389,
    username: 'chenzhi',
    password: 'p@ss word',
    domain: 'CORP'
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].target, 'TERMSRV/10.0.0.8')
  assert.deepEqual(rows[0].args, [
    '/generic:TERMSRV/10.0.0.8',
    '/user:CORP\\chenzhi',
    // 含空格的值必须加引号：cmdkey 会重新解析命令行，不加引号时会认为缺少 /user: 并 exit 1
    // （真机实测；详见 lib/cmdkeyArgs.mjs 的 quoteForCmdkey 注释与 test/cmdkeyArgsQuoting.test.js）
    '/pass:"p@ss word"'
  ])

  const two = storeCredentialArgs({ host: 'win-srv', port: 13389, username: 'ops' })
  assert.equal(two.length, 2)
  assert.deepEqual(
    two.map((row) => row.args[0]),
    ['/generic:TERMSRV/win-srv', '/generic:TERMSRV/win-srv:13389']
  )
  assert.deepEqual(two[1].args, ['/generic:TERMSRV/win-srv:13389', '/user:ops', '/pass:'])
})

test('deleteCredentialArgs：/delete，同样两条策略', () => {
  assert.deepEqual(deleteCredentialArgs({ host: 'win-srv', port: 3389 }), [
    { target: 'TERMSRV/win-srv', args: ['/delete:TERMSRV/win-srv'] }
  ])
  assert.deepEqual(deleteCredentialArgs({ host: 'win-srv', port: 13389 }), [
    { target: 'TERMSRV/win-srv', args: ['/delete:TERMSRV/win-srv'] },
    { target: 'TERMSRV/win-srv:13389', args: ['/delete:TERMSRV/win-srv:13389'] }
  ])
})
