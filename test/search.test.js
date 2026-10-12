/**
 * 卡片列表搜索的匹配器单测（规格 `docs/spec/rdp-search-box.md`）。
 *
 * 逐条钉住 `src/search.js` 的匹配语义：子序列、大小写、四档加权（前缀 / 词首 / 连续 / 离散）、
 * 中文与主机名 / IP:端口、多词 AND、空查询保序、首尾空白；并单独钉住"搜的是 rdp 的真实字段"
 * （`name` / `host` / `port` / `username` / `domain` + 派生标题），**不搜**条目里不存在的文本。
 *
 * 与 `extensions/webapp/test/search.test.js`（另一个用户扩展的同款搜索）语义同源：两边改动需同步。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  filterAndRank,
  isSearching,
  isWordStart,
  parseQuery,
  scoreEntry,
  scoreTerm
} from '../src/search.js'

/** 三条真实形状的连接行（字段照 lib/connection.mjs 的库行） */
const rows = [
  { id: 1, name: '生产跳板机', host: '10.0.0.8', port: 3389, username: 'chenzhi', domain: 'CORP' },
  {
    id: 2,
    name: '测试环境',
    host: 'test-win-01.corp.example.com',
    port: 13389,
    username: 'svc_test',
    domain: ''
  },
  { id: 3, name: '财务内网', host: '192.168.1.20', port: 3389, username: 'li.ming', domain: 'FIN' }
]

/** 只取 id，断言顺序/命中集合时比整行更清楚 */
function ids(list) {
  return list.map((row) => row.id)
}

/* ---------- 1. 子序列命中 / 不命中 ---------- */

test('子序列命中：查询字符按顺序出现即命中（chzi → chenzhi）', () => {
  assert.ok(scoreEntry(rows[0], parseQuery('chzi')) > 0, 'chzi 应是 chenzhi 的子序列')
  assert.deepEqual(ids(filterAndRank(rows, 'chzi')), [1])
})

test('不命中：顺序对不上的字符不算命中（izhc），完全无关的词也返回空', () => {
  // i→c→h→z 与 chenzhi 的字符顺序不符
  assert.equal(scoreEntry(rows[0], parseQuery('izhc')), 0)
  assert.deepEqual(ids(filterAndRank(rows, 'izhc')), [])
  assert.deepEqual(ids(filterAndRank(rows, 'zzzzz')), [])
})

/* ---------- 2. 大小写不敏感 ---------- */

test('大小写不敏感：查询大写 = 小写（用户名 / 域 / 主机名三处都验）', () => {
  for (const [upper, lower] of [
    ['CHENZHI', 'chenzhi'],
    ['CORP', 'corp'],
    ['TEST-WIN-01', 'test-win-01'],
    ['FIN', 'fin']
  ]) {
    assert.deepEqual(ids(filterAndRank(rows, upper)), ids(filterAndRank(rows, lower)), upper)
  }
})

/* ---------- 3. 前缀 / 词首 / 连续 / 离散 四档排名 ---------- */

test('加权四档：前缀 > 词首（分隔符边界）> 连续片段 > 离散子序列', () => {
  const prefix = scoreTerm('内网平台', '内网', '内网平台').score
  const wordStart = scoreTerm('财务-内网', '内网', '财务-内网').score
  const substring = scoreTerm('财务内网', '内网', '财务内网').score
  const scattered = scoreTerm('内xx网', '内网', '内xx网').score
  assert.ok(prefix > wordStart, `前缀 ${prefix} 应高于词首 ${wordStart}`)
  assert.ok(wordStart > substring, `词首 ${wordStart} 应高于连续片段 ${substring}`)
  assert.ok(substring > scattered, `连续片段 ${substring} 应高于离散子序列 ${scattered}`)
  // 前缀 / 词首 / 连续 / 离散 全部算命中（只是分不同）
  for (const [field, term] of [
    ['内网平台', '内网'],
    ['财务-内网', '内网'],
    ['财务内网', '内网'],
    ['内xx网', '内网']
  ]) {
    assert.equal(scoreTerm(field, term, field).matched, true, `${field} 应命中 ${term}`)
  }
})

test('filterAndRank 按分数降序：同一查询下前缀命中的行排在最前', () => {
  const ranked = [
    { id: 'substring', name: '财务内网' },
    { id: 'scattered', name: '内xx网' },
    { id: 'wordstart', name: '财务-内网' },
    { id: 'prefix', name: '内网平台' }
  ]
  assert.deepEqual(ids(filterAndRank(ranked, '内网')), [
    'prefix',
    'wordstart',
    'substring',
    'scattered'
  ])
})

test('isWordStart：串首 / 分隔符后 / 驼峰边界算词首，普通位置不算', () => {
  assert.equal(isWordStart('corp.example', 0), true)
  assert.equal(isWordStart('corp.example', 5), true) // '.' 之后
  assert.equal(isWordStart('prodHost', 4), true) // 驼峰边界（t→H）
  assert.equal(isWordStart('prodhost', 4), false) // 全小写，不是词首
  assert.equal(isWordStart('chenzhi@10.0.0.8', 8), true) // '@' 之后
})

/* ---------- 4. 中文 / 主机名 / IP:端口 ---------- */

test('中文：连接名的任意连续片段都能命中', () => {
  assert.deepEqual(ids(filterAndRank(rows, '跳板')), [1])
  assert.deepEqual(ids(filterAndRank(rows, '内网')), [3])
})

test('主机名：域名式主机名可按片段命中', () => {
  assert.deepEqual(ids(filterAndRank(rows, 'test-win')), [2])
  assert.deepEqual(ids(filterAndRank(rows, 'example.com')), [2])
})

test('IP：按片段命中目标地址', () => {
  assert.deepEqual(ids(filterAndRank(rows, '192.168')), [3])
  assert.deepEqual(ids(filterAndRank(rows, '10.0.0.8')), [1])
})

test('IP:端口：端口列与卡片标题都能命中（非默认端口也不例外）', () => {
  // 13389 在 2 号的端口列上**前缀**命中 ⇒ 分最高，排最前；
  // 1 / 3 号的端口是 3389，只能作为子序列在标题里命中（1,3,3,8,9 按序出现）⇒ 排在后面
  assert.deepEqual(ids(filterAndRank(rows, '13389')), [2, 1, 3])
  assert.deepEqual(ids(filterAndRank(rows, '10.0.0.8:3389')), [1])
  // 默认端口：端口列前缀命中的两条排在最前（分数相同 ⇒ 保持原序）
  const portHits = ids(filterAndRank(rows, '3389'))
  assert.deepEqual(portHits.slice(0, 2), [1, 3])
  // 子串语义（不是整词匹配）：「13389」里含「3389」⇒ 也算命中，只是分更低
  assert.ok(portHits.includes(2), '13389 含 3389，应按子串命中')
  assert.equal(portHits.length, 3)
})

test('用户名与域各自可搜；派生标题让「照卡片上的文字搜」命中（chenzhi@10）', () => {
  assert.deepEqual(ids(filterAndRank(rows, 'svc_test')), [2])
  assert.deepEqual(ids(filterAndRank(rows, 'li.ming')), [3])
  assert.deepEqual(ids(filterAndRank(rows, 'FIN')), [3])
  // 跨字段连写（用户名 + 主机）只有派生标题这一项能命中
  assert.deepEqual(ids(filterAndRank(rows, 'chenzhi@10')), [1])
})

test('只搜条目里真实存在的文本：没有 host / port 的条目不会被 ":3389" 命中', () => {
  assert.equal(scoreEntry({ name: '随便' }, parseQuery('3389')), 0)
  assert.equal(scoreEntry({ name: '随便' }, parseQuery('3389:')), 0)
})

/* ---------- 5. 多词 AND ---------- */

test('多词 AND：全词都要命中同一个条目，命中不同条目不算', () => {
  // 两个词落在同一条目的不同字段上（name + host）
  assert.deepEqual(ids(filterAndRank(rows, '跳板 10.0.0.8')), [1])
  // 两个词分别命中不同的条目 → 都不返回（AND，不是 OR）
  assert.deepEqual(ids(filterAndRank(rows, '跳板 test-win')), [])
  // 同一个字段里两个词都命中
  assert.deepEqual(ids(filterAndRank(rows, '财务 内网')), [3])
})

test('多词是"各词取最优字段分"再累加：词序不影响命中集合', () => {
  assert.deepEqual(ids(filterAndRank(rows, '内网 财务')), ids(filterAndRank(rows, '财务 内网')))
  assert.ok(
    scoreEntry(rows[2], parseQuery('财务 内网')) > scoreEntry(rows[2], parseQuery('财务')),
    '多命中一个词应得更高分'
  )
})

/* ---------- 6. 空查询 / 纯空白 → 全部且保序 ---------- */

test('空查询 / 纯空白 / null / undefined → 返回全部且保持原顺序', () => {
  const ordered = [rows[2], rows[0], rows[1]] // 故意不是 id 升序
  for (const query of ['', '   ', '\t\n', null, undefined]) {
    assert.deepEqual(ids(filterAndRank(ordered, query)), [3, 1, 2], JSON.stringify(query))
  }
})

test('空查询返回的是副本（界面改动它不会污染原列表）', () => {
  const out = filterAndRank(rows, '')
  assert.deepEqual(ids(out), [1, 2, 3])
  out.push({ id: 99 })
  assert.equal(rows.length, 3)
})

/* ---------- 7. 首尾空白处理 ---------- */

test("首尾空白被丢掉：'  内网  ' 与 '内网' 等价", () => {
  assert.deepEqual(ids(filterAndRank(rows, '  内网  ')), ids(filterAndRank(rows, '内网')))
  assert.deepEqual(parseQuery('  Foo \t bar  '), ['foo', 'bar'])
})

test('isSearching：空 / 纯空白 = 没在搜；含词 = 在搜', () => {
  for (const query of ['', '   ', '\t', null, undefined]) {
    assert.equal(isSearching(query), false, JSON.stringify(query))
  }
  assert.equal(isSearching(' a '), true)
  assert.equal(isSearching('内网'), true)
})

/* ---------- 8. 同分保原序 / 边界输入 ---------- */

test('同分保持原序（不靠 sort 的稳定性假设）', () => {
  const tied = [
    { id: 10, name: '同名主机', host: '10.0.0.1' },
    { id: 11, name: '同名主机', host: '10.0.0.1' },
    { id: 12, name: '同名主机', host: '10.0.0.1' }
  ]
  assert.deepEqual(ids(filterAndRank(tied, '同名')), [10, 11, 12])
  assert.deepEqual(ids(filterAndRank([...tied].reverse(), '同名')), [12, 11, 10])
})

test('边界输入：scoreEntry 空词表 / 非数组 / 畸形条目都不抛错', () => {
  assert.equal(scoreEntry(rows[0], []), 0)
  assert.equal(scoreEntry(null, parseQuery('a')), 0)
  assert.deepEqual(filterAndRank(null, 'a'), [])
  assert.deepEqual(filterAndRank(undefined, ''), [])
  assert.deepEqual(ids(filterAndRank([{}, null], 'a')), [])
})
