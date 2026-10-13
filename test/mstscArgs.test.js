/**
 * `lib/mstscArgs.mjs` 的纯函数测试：cmd 命令行构造 + mstsc 路径解析。
 *
 * **故意不真的派发**（不 spawn cmd/mstsc）：本文件只钉"参数数组长什么样、什么该被拒"。
 * 真机语义（父进程已死、obox 关掉后 mstsc 仍在）需要真实窗口与进程树，属人工验收
 * （见 `docs/adr/0003-mstsc-orphan-launch-via-cmd.md` 与扩展 spec §16.2）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildStartArgs, resolveMstscPath } from '../lib/mstscArgs.mjs'

const MSTSC = 'C:\\Windows\\System32\\mstsc.exe'

describe('buildStartArgs：参数数组形态', () => {
  it('恰好 5 个元素：/c start "" <mstsc> <.rdp>', () => {
    const args = buildStartArgs(MSTSC, 'C:\\d\\1.rdp')
    assert.deepEqual(args, ['/c', 'start', '', MSTSC, 'C:\\d\\1.rdp'])
    assert.equal(args.length, 5)
  })

  it('第 3 个元素必须是空串：start 的窗口标题占位不能丢（丢了路径会被当标题）', () => {
    assert.equal(buildStartArgs(MSTSC, 'C:\\d\\1.rdp')[2], '')
  })

  it('首尾空白会被 trim（路径本身不该带空白，但别把空白传成 token）', () => {
    assert.deepEqual(buildStartArgs(` ${MSTSC} `, ' C:\\d\\1.rdp '), [
      '/c',
      'start',
      '',
      MSTSC,
      'C:\\d\\1.rdp'
    ])
  })
})

describe('buildStartArgs：转义矩阵（函数不加引号、不转义、不截断）', () => {
  // 真机实测（Windows 11 26200）：下列字符经 cmd /c start 全部原样到达目标进程，
  // 唯一会被展开的是 %VAR%（见拒绝矩阵）。→ 函数必须原样返回。
  const cases = [
    ['空格', 'C:\\obox probe\\1.rdp'],
    ['中文/井号', 'C:\\会话 #1.rdp'],
    ['&', 'C:\\a&b\\1.rdp'],
    ['^', 'C:\\a^b\\1.rdp'],
    ['括号', 'C:\\(a) b\\1.rdp'],
    ['!', 'C:\\a!b\\1.rdp'],
    ['% 不配对（探针 P-3 实测原样到达）', 'C:\\100% done\\1.rdp'],
    ['| < >', 'C:\\a|b\\c<d>e\\1.rdp']
  ]

  for (const [name, path] of cases) {
    it(`${name}：第 5 个元素与输入逐字符相同`, () => {
      const args = buildStartArgs(MSTSC, path)
      assert.equal(args[4], path)
      assert.equal(args.length, 5)
    })
  }

  it('第 4 个元素（mstsc 路径）同样原样传', () => {
    assert.equal(
      buildStartArgs('C:\\Program Files\\mstsc.exe', 'C:\\d\\1.rdp')[3],
      'C:\\Program Files\\mstsc.exe'
    )
  })
})

describe('buildStartArgs：拒绝矩阵', () => {
  it('%VAR% 形态：抛错（cmd 会把它展开成别的目录，静默改写路径）', () => {
    assert.throws(() => buildStartArgs(MSTSC, 'C:\\%TEMP%\\1.rdp'), /含 %/)
  })

  it('其它 %VAR% 变体也抛错：未定义变量、%%、两个不相关的 %', () => {
    assert.throws(() => buildStartArgs(MSTSC, 'C:\\%NOSUCHVAR%\\1.rdp'), /含 %/)
    assert.throws(() => buildStartArgs(MSTSC, 'C:\\a%%b\\1.rdp'), /含 %/)
    assert.throws(() => buildStartArgs(MSTSC, 'C:\\a%\\1%b.rdp'), /含 %/)
  })

  it('只有**不配对**的单个 % 放行（§6.3 的字符表 + §17.2 的矩阵口径）', () => {
    // 与 §6.1 示例代码的 includes('%') 有刻意偏离，理由写在 lib/mstscArgs.mjs 的文件头与 ADR-0003
    assert.equal(buildStartArgs(MSTSC, 'C:\\50%\\1.rdp')[4], 'C:\\50%\\1.rdp')
    assert.equal(buildStartArgs(MSTSC, 'C:\\100% done\\1.rdp')[4], 'C:\\100% done\\1.rdp')
  })

  it('双引号：抛错', () => {
    assert.throws(() => buildStartArgs(MSTSC, 'C:\\a"b\\1.rdp'), /引号或换行/)
  })

  it('换行（\\n / \\r）：抛错', () => {
    assert.throws(() => buildStartArgs(MSTSC, 'C:\\a\nb\\1.rdp'), /引号或换行/)
    assert.throws(() => buildStartArgs(MSTSC, 'C:\\a\rb\\1.rdp'), /引号或换行/)
  })

  it('空路径 / 空 mstsc / 缺参：抛错', () => {
    assert.throws(() => buildStartArgs(MSTSC, ''), /需要 \.rdp 绝对路径/)
    assert.throws(() => buildStartArgs(MSTSC, '   '), /需要 \.rdp 绝对路径/)
    assert.throws(() => buildStartArgs(MSTSC), /需要 \.rdp 绝对路径/)
    assert.throws(() => buildStartArgs('', 'C:\\d\\1.rdp'), /需要 mstsc 绝对路径/)
    assert.throws(() => buildStartArgs(undefined, undefined), /需要 mstsc 绝对路径/)
  })
})

describe('buildStartArgs：回归护栏（防"好心加引号"）', () => {
  it('函数永远不自己加引号：那是 Node 在 windowsVerbatimArguments:false 下的事', () => {
    // 后人若"照着 quoteForCmdkey 的样子"给这里也加一层引号，就会破坏 Node 的转义：
    // cmd 会先吃掉自己那层引号，start 拿到的路径就变成 `C:\obox`（空格后被截断）+ 半截。
    for (const path of ['C:\\obox probe\\1.rdp', 'C:\\会话 #1.rdp', 'C:\\a&b\\1.rdp']) {
      const args = buildStartArgs(MSTSC, path)
      assert.ok(!args.some((a) => a.startsWith('"') && a.endsWith('"')), `${path} 不得被加引号`)
      assert.ok(!args[4].includes('\\"'), '不得用反斜杠转义引号')
      assert.equal(args[4], path)
    }
  })
})

describe('resolveMstscPath：路径解析', () => {
  it('SystemRoot 优先', () => {
    assert.equal(
      resolveMstscPath({ SystemRoot: 'C:\\WINDOWS' }),
      'C:\\WINDOWS\\System32\\mstsc.exe'
    )
  })

  it('SystemRoot 带尾反斜杠/尾斜杠：不出现双斜杠', () => {
    assert.equal(
      resolveMstscPath({ SystemRoot: 'C:\\WINDOWS\\' }),
      'C:\\WINDOWS\\System32\\mstsc.exe'
    )
    assert.equal(resolveMstscPath({ SystemRoot: 'C:/Windows/' }), 'C:/Windows\\System32\\mstsc.exe')
    assert.ok(!resolveMstscPath({ SystemRoot: 'C:\\WINDOWS\\' }).includes('\\\\'))
  })

  it('没有 SystemRoot 时退回 windir', () => {
    assert.equal(resolveMstscPath({ windir: 'D:\\Win' }), 'D:\\Win\\System32\\mstsc.exe')
  })

  it('两个都没有时退回 C:\\Windows（不抛错）', () => {
    assert.equal(resolveMstscPath({}), 'C:\\Windows\\System32\\mstsc.exe')
    assert.equal(resolveMstscPath(), resolveMstscPath(process.env), '缺省参数用 process.env')
  })

  it('解析结果能直接喂给 buildStartArgs', () => {
    const mstsc = resolveMstscPath({ SystemRoot: 'C:\\WINDOWS' })
    assert.deepEqual(buildStartArgs(mstsc, 'C:\\d\\1.rdp'), [
      '/c',
      'start',
      '',
      'C:\\WINDOWS\\System32\\mstsc.exe',
      'C:\\d\\1.rdp'
    ])
  })
})
