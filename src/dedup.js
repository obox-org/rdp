/**
 * 「同一卡片 1 秒内的重复点击直接忽略」的**静默去重**（纯函数，零依赖；可 `node --test`）。
 *
 * 为什么需要它：卡片右上角的状态点（含"打开中"的禁用态）已于 1.0.3 随"提示只写控制台"
 * 一起**整体移除**（用户裁定：连状态点也不留），于是"点两下会开出两个 mstsc 窗口"这件事
 * 失去了原有的挡板。裁定给的替代品就是本模块：**界面上不出现任何变化**（不加禁用态、不加
 * 文案、不写日志），只在时间窗内把重复点击吞掉。
 *
 * 边界口径（写入测试，改行为必须同步改断言）：
 * - **窗口从"上一次被接受的点击"起算**：`now - 上次 < windowMs` ⇒ 忽略；**恰好等于 `windowMs`
 *   时不再忽略**（`1000ms` 与 `1001ms` 等价，都是"过了 1 秒"）。
 * - **一次点击无论成败都占用窗口**：失败后 1 秒内的重试也会被静默忽略。这是"1 秒内重复点击
 *   直接忽略"的字面口径；代价见 README §14 与实现报告的"边界处理"。
 * - **窗口不跟随 IPC 时长**：`open` 慢于 1 秒（例如 cmdkey 卡住）时第二次点击会被放行。
 *   要更严得改成"在飞请求未回前一律忽略"——那需要状态，与"不加禁用态"的裁定相冲，故不做。
 * - 时钟回拨（`now` 变小）不锁死：只把这次当作新的基准时间。
 *
 * @param {{ windowMs?: number, now?: () => number }} [options]
 * @returns {{ shouldIgnore: (id: unknown) => boolean, forget: (id: unknown) => void, clear: () => void }}
 */
export function createOpenDedup(options = {}) {
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : 1000
  const now = typeof options.now === 'function' ? options.now : Date.now
  /** 卡片 id（统一按字符串做键：库里的 id 是数字，界面偶尔会用 `temp-…` 字符串）→ 上次放行时刻 */
  const lastAcceptedAt = new Map()

  return {
    /**
     * 这次点击要不要**静默忽略**？
     * 返回 `false` 表示"放行"，同时把此刻记为新的基准时间；返回 `true` 表示窗口内重复，调用方
     * 必须**什么都不做**（不派发、不改界面、不写日志）。
     */
    shouldIgnore(id) {
      const key = String(id)
      const at = now()
      const previous = lastAcceptedAt.get(key)
      if (previous !== undefined && at >= previous && at - previous < windowMs) return true
      lastAcceptedAt.set(key, at)
      return false
    },

    /** 忘掉某张卡片的窗口（删除连接后调用：该 id 不该把新连接挡在窗口外） */
    forget(id) {
      lastAcceptedAt.delete(String(id))
    },

    /** 清空全部窗口（组件卸载时调用） */
    clear() {
      lastAcceptedAt.clear()
    }
  }
}
