/**
 * 连接卡片列表的模糊搜索（**纯函数、零依赖、无 Vue**，规格见 `docs/spec/rdp-search-box.md`）。
 *
 * ⚠️ 本文件与另一个用户扩展 `extensions/webapp/src/search.js` 是**同一套匹配语义 + 同一份 API 形状**
 * （导出 `scoreTerm` / `isWordStart` / `scoreEntry` / `parseQuery` / `filterAndRank` / `isSearching`，
 * 常量、加权档位、AND/保序口径逐条一致），差别**只有**「搜哪些字段」——那是各扩展自己的数据形状。
 * 改这里的任何一条语义，必须同步改 webapp 侧与两边的测试，否则两个扩展的搜索行为会漂开。
 *
 * 匹配语义（全部可测，`test/search.test.js` 逐条钉住）：
 * 1. **大小写不敏感**（`Query` 与 `QUERY` 命中同一条目）；
 * 2. 对**每个字段分别打分，取最优**（一个条目只会因为最好的那个字段得分）。rdp 条目参与搜索的字段
 *    是它**真实的数据列**（`lib/connection.mjs` 的库行 / README §5 的字段表）加一项界面派生值：
 *    | 字段       | 含义                                             |
 *    | ---------- | ------------------------------------------------ |
 *    | `name`     | 连接名（卡片副行）                               |
 *    | `host`     | 主机（IP / 主机名）                              |
 *    | `port`     | 端口（不填按 3389）                              |
 *    | `username` | 用户名                                           |
 *    | `domain`   | 域                                               |
 *    | `title`    | 卡片标题 `[username@]host:port`（**派生**，见下） |
 *    派生 `title` 取自 `fields.js` 的 `titleOf()`（与卡片显示**同一个来源**，不重写一遍格式），
 *    目的是"照着卡片上看到的文字搜也能命中"（例如 `chenzhi@10.0.0.8` 这种跨字段的连写）；
 *    `host` 为空的畸形条目**不参与**该项，避免凭空造出 `:3389` 这种假文本；
 * 3. **子序列匹配**：查询字符按顺序出现在候选里即算命中（`nwpt` 命中 `内网平台` 的拼音首字母式输入、
 *    `gtlb` 命中 `google.com/login`）；
 * 4. **加权**：整串包含 > 前缀命中 > 词首命中（驼峰/分隔符边界）> 离散子序列，
 *    并再乘一个"命中密度"系数（命中的字符越集中，分越高）；
 * 5. 查询按空白拆成多个词 → **全词都要命中**（AND）；
 * 6. **空查询 / 纯空白 → 返回全部且不改变原顺序**（界面直接拿到原列表）。
 *
 * 排序由 `filterAndRank()` 负责：**按分数降序；同分保持原序**（`Array.prototype.sort` 自 ES2019
 * 起是稳定排序，所以"同分保序"是可靠的，不依赖实现细节；且下面还显式比较了原索引）。
 */
import { titleOf } from './fields.js'

/** 各档命中方式的基准分（数值大小只影响排序，不对外承诺具体分数） */
const SCORE_SUBSTRING = 1000
const SCORE_PREFIX = 1600
const SCORE_WORD_START = 1300
const SCORE_SUBSEQUENCE = 600
/** 每个匹配字符的基础分（让"匹配得更长"的候选略占优） */
const SCORE_PER_CHAR = 10

/** 词首边界：字符串开头，或前一个字符是分隔符/空白，或当前字符是大写而前一个不是 */
const WORD_SEPARATORS = new Set([' ', '-', '_', '/', '\\', '.', ':', '?', '&', '=', '#', '@', '+'])

/**
 * 单个词对**一个字段**的打分。
 *
 * @param {string} field 已小写化的候选字段
 * @param {string} term 已小写化的查询词（非空）
 * @param {string} rawField 原样字段（用于判定大写边界的词首）
 * @returns {{ matched: boolean, score: number }}
 */
export function scoreTerm(field, term, rawField = field) {
  if (!term) return { matched: true, score: 0 }
  if (!field) return { matched: false, score: 0 }

  const index = field.indexOf(term)
  if (index >= 0) {
    const base =
      index === 0 ? SCORE_PREFIX : isWordStart(rawField, index) ? SCORE_WORD_START : SCORE_SUBSTRING
    // 命中占比：词越长越"值钱"，但相对字段长度做归一，避免长字段自动占优
    const density = term.length / field.length
    return { matched: true, score: base + term.length * SCORE_PER_CHAR + density * 100 }
  }

  // 子序列匹配（按顺序出现的字符）
  let cursor = 0
  let span = 0
  let first = -1
  let last = -1
  for (let i = 0; i < field.length && cursor < term.length; i++) {
    if (field[i] === term[cursor]) {
      if (first < 0) first = i
      last = i
      cursor += 1
    }
  }
  if (cursor < term.length) return { matched: false, score: 0 }

  span = last - first + 1
  // 越紧凑（span 越接近词长）越高分；离散命中仍算命中，但排在连续/前缀命中之后
  const compactness = term.length / span
  const prefixBonus = first === 0 ? 120 : 0
  return {
    matched: true,
    score: SCORE_SUBSEQUENCE + term.length * SCORE_PER_CHAR + compactness * 200 + prefixBonus
  }
}

/** 该位置是否是"词首"（用于前缀之外的加权） */
export function isWordStart(rawField, index) {
  if (index <= 0) return true
  const previous = String(rawField)[index - 1] ?? ''
  const current = String(rawField)[index] ?? ''
  if (WORD_SEPARATORS.has(previous)) return true
  // 驼峰边界：前一个小写、当前大写
  return /[a-z0-9]/.test(previous) && /[A-Z]/.test(current)
}

/**
 * 条目 → 参与搜索的候选文本数组（**rdp 的真实字段**，见文件头表格）。
 *
 * `title` 是派生项（卡片标题），只在 `host` 非空时给出：`titleOf()` 对空 host 会拼出 `:3389`，
 * 那种"条目里并不存在"的文本不该被搜到。
 *
 * @param {Record<string, unknown>} entry 连接行
 * @returns {string[]} 原样（未小写化）的候选字段
 */
function fieldsOf(entry) {
  const host = String(entry?.host ?? '')
  const port = entry?.port === undefined || entry?.port === null ? '' : String(entry.port)
  return [
    String(entry?.name ?? ''),
    host,
    port,
    String(entry?.username ?? ''),
    String(entry?.domain ?? ''),
    host ? titleOf(entry) : ''
  ]
}

/**
 * 一个条目对一组查询词的加权得分（**每个字段各算一次，取最优**，再按词累加）。
 *
 * @param {Record<string, unknown>} entry 条目（读 `name` / `host` / `port` / `username` / `domain` / 标题）
 * @param {string[]} terms 查询词（已小写化、已去空）
 * @returns {number} `0` = **不命中**（调用方据此过滤）；> 0 = 命中，分数越高越靠前
 */
export function scoreEntry(entry, terms) {
  if (!terms.length) return 0
  const fields = fieldsOf(entry)
  let total = 0
  for (const term of terms) {
    let best = 0
    for (const rawField of fields) {
      const { matched, score } = scoreTerm(rawField.toLowerCase(), term, rawField)
      if (matched && score > best) best = score
    }
    // **AND**：任何一个词在所有字段里都找不到 → 整条不命中
    if (best <= 0) return 0
    total += best
  }
  return total
}

/** 查询 → 小写化的词数组（按空白拆分、丢弃空段） */
export function parseQuery(query) {
  return String(query ?? '')
    .trim()
    .split(/\s+/)
    .filter((term) => term !== '')
    .map((term) => term.toLowerCase())
}

/**
 * 过滤 + 排序（界面唯一入口）。
 *
 * - 查询为空（`''` / `null` / 纯空白）→ **原样返回**（同一个数组内容，顺序不变）；
 * - 否则只保留命中项，**按分数降序**；同分保持原序（稳定排序 + 显式比较原索引）。
 *
 * @param {Array<Record<string, unknown>>} rows 待过滤的条目（**已经是界面要展示的顺序**）
 * @param {unknown} query 用户输入的原始查询
 * @returns {Array<Record<string, unknown>>}
 */
export function filterAndRank(rows, query) {
  const list = Array.isArray(rows) ? rows : []
  const terms = parseQuery(query)
  if (!terms.length) return list.slice()
  return list
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // 同分保序（显式比较索引，不依赖 sort 的稳定性假设）
      return a.index - b.index
    })
    .map((item) => item.entry)
}

/** 是否处于"正在搜索"状态（界面用它区分「还没有条目」与「无匹配」两种空态） */
export function isSearching(query) {
  return parseQuery(query).length > 0
}
