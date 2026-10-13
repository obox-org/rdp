<script setup>
/**
 * 远程桌面子应用主界面（设计 §3.9.1）。
 * 结构：sticky header（56px）→ 搜索框（有连接时才出现；v1.0.1 引入、v1.0.2 美化）→ 卡片网格 / 空态；
 * 模态框与删除确认挂在这里。
 * **底部状态栏已于 1.0.3 整体移除**（用户要求与 `extensions/webapp` 同形态）：所有操作结果与
 * `cmdkey` 告警**只写控制台**（`console.info`/`console.error`，前缀 `[rdp]`），界面上不出现任何
 * 提示（卡片右上角的状态点与"点开看错误原文"也一并移除）。详见 README §14 与 `docs/adr/0003`。
 * 数据全部经 bridge.js 的 callExtension(method, payload) 走宿主消息桥，页面内没有 api 对象。
 * 列表展示只用 `visibleRows`（= search.js 的 filterAndRank，见 docs/spec/rdp-search-box.md）。
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import ConnectionCard from './components/ConnectionCard.vue'
import ConnectionModal from './components/ConnectionModal.vue'
import DeleteConfirm from './components/DeleteConfirm.vue'
import EmptyState from './components/EmptyState.vue'
import { callExtension } from './bridge.js'
import { createOpenDedup } from './dedup.js'
import { titleOf, subtitleOf } from './fields.js'
import { filterAndRank, isSearching } from './search.js'

const rows = ref([])
const loading = ref(true)

/** 搜索框内容（v1.0.1）：非空时列表只显示命中项，按分数降序 */
const searchQuery = ref('')
/** 是否处于"正在搜索"（空 / 纯空白 = 没在搜，直接展示全部） */
const searching = computed(() => isSearching(searchQuery.value))
/** 展示用列表：空查询 ⇒ 原样（新→旧）；有查询 ⇒ 过滤 + 按分数降序（同分保原序） */
const visibleRows = computed(() => filterAndRank(rows.value, searchQuery.value))

const modalOpen = ref(false)
const modalMode = ref('create')
const modalRow = ref(null)
const saving = ref(false)
const saveError = ref('')

const deleteRow = ref(null)
const deleting = ref(false)

/**
 * 「打开」的**静默去重**：同一卡片 1 秒内的重复点击直接忽略。
 *
 * 卡片状态点（含"打开中"的禁用态）已随状态栏一起移除，所以双击不会再被 `disabled` 挡住；
 * 这里按用户裁定的时间窗补上，且**界面不出现任何变化**（不加禁用态、不加文案、不写日志）。
 */
const openDedup = createOpenDedup()

const connectionsText = computed(() => `⟨${rows.value.length} 个连接⟩`)

/** 打开模态框的触发元素，关闭后焦点回到它（§3.9.5） */
let triggerEl = null
const createButton = ref(null)

/**
 * 记录一次操作结果。
 *
 * ⚠️ **用户已要求界面不显示操作/错误提示**（底部状态栏整体移除），因此这里**只写控制台**、不写任何 UI。
 *
 * 为什么保留全部调用点而不是把调用删掉：这些日志是**唯一的诊断通道**
 * （子窗口日志会经主进程转发到终端，前缀 `[child-renderer:*]`）。
 * 出问题时让用户开 DevTools / 看终端即可还原完整过程。
 *
 * @param {'info'|'ok'|'error'} [kind] 成功走 `console.info`、失败走 `console.error`
 * @param {string} text 面向人的一句话
 */
function setStatus(kind, text) {
  if (kind === 'error') console.error(`[rdp] ${text}`)
  else console.info(`[rdp] ${text}`)
}

function rememberTrigger() {
  triggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function restoreFocus() {
  nextTick(() => {
    if (triggerEl && triggerEl.isConnected) triggerEl.focus()
    else createButton.value?.focus()
    triggerEl = null
  })
}

/**
 * 列表顺序：扩展的 `list` 按 `createdAt` 升序（最旧在前），界面按**最新在前**展示，
 * 与「新建的卡片立刻插到列表顶部」（§3.9.2）保持一致。
 */
function newestFirst(rows) {
  return [...rows].sort((a, b) => {
    const ca = String(a?.createdAt ?? '')
    const cb = String(b?.createdAt ?? '')
    if (ca !== cb) return ca < cb ? 1 : -1
    return Number(b?.id ?? 0) - Number(a?.id ?? 0)
  })
}

async function refresh() {
  loading.value = true
  try {
    const data = await callExtension('list', {})
    rows.value = newestFirst(Array.isArray(data) ? data : [])
    setStatus('info', `已加载 ${rows.value.length} 个连接`)
  } catch (err) {
    rows.value = []
    setStatus('error', `读取连接列表失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

/**
 * 静默对账：保存/删除这类乐观更新失败后，用扩展的真实数据回填（不写额外提示）。
 * 例：扩展报「连接已保存，但密码未保存」——库行其实写进去了，本地回滚反而会与库不一致。
 */
async function reconcile() {
  try {
    const data = await callExtension('list', {})
    rows.value = newestFirst(Array.isArray(data) ? data : [])
  } catch {
    /* 对账失败就保留本地回滚结果，错误原因已写进控制台日志 */
  }
}

/** 扩展返回的 warnings（如「本机凭据未清理」）拼进写控制台的那句话 */
function warningSuffix(data) {
  const list = Array.isArray(data?.warnings) ? data.warnings.filter(Boolean) : []
  return list.length > 0 ? `（${list.join('；')}）` : ''
}

function openCreate() {
  rememberTrigger()
  modalMode.value = 'create'
  modalRow.value = null
  saveError.value = ''
  saving.value = false
  modalOpen.value = true
}

function openEdit(row) {
  rememberTrigger()
  modalMode.value = 'edit'
  modalRow.value = row
  saveError.value = ''
  saving.value = false
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  modalRow.value = null
  restoreFocus()
}

/** 保存返回值的兼容处理：对象（行）取其内容，数字/字符串在新建时当作新 id */
function mergeSaved(saved, payload, previousId) {
  const safe = stripPassword(payload)
  if (saved && typeof saved === 'object') {
    return { ...safe, ...saved, id: saved.id ?? previousId ?? safe.id }
  }
  if (!previousId && (typeof saved === 'number' || typeof saved === 'string') && saved !== '') {
    return { ...safe, id: saved }
  }
  return { ...safe, id: previousId ?? safe.id }
}

/** 密码只走扩展的 api.secrets，绝不留在页面状态里 */
function stripPassword(payload) {
  const safe = { ...payload }
  delete safe.password
  return safe
}

async function saveConnection(payload) {
  saving.value = true
  saveError.value = ''
  const isEdit = payload.id !== undefined && payload.id !== null && payload.id !== ''
  const tempId = `temp-${Date.now()}`
  const index = isEdit ? rows.value.findIndex((row) => String(row.id) === String(payload.id)) : -1
  const backup = index >= 0 ? rows.value[index] : null
  const safe = stripPassword(payload)

  // 乐观更新：先把卡片放上去（新建插到顶部），失败再回滚
  if (isEdit && index >= 0) rows.value.splice(index, 1, { ...backup, ...safe, id: payload.id })
  else if (!isEdit) rows.value.unshift({ ...safe, id: tempId })

  try {
    const saved = await callExtension('save', payload)
    const record = mergeSaved(saved, payload, isEdit ? payload.id : null)
    if (isEdit) {
      const at = rows.value.findIndex((row) => String(row.id) === String(payload.id))
      if (at >= 0) rows.value.splice(at, 1, record)
      else rows.value.unshift(record)
    } else {
      const at = rows.value.findIndex((row) => String(row.id) === String(tempId))
      if (at >= 0) rows.value.splice(at, 1, record)
    }
    setStatus('ok', isEdit ? `已更新连接 ${titleOf(record)}` : `已新建连接 ${titleOf(record)}`)
    closeModal()
  } catch (err) {
    // 回滚乐观更新
    if (isEdit) {
      const at = rows.value.findIndex((row) => String(row.id) === String(payload.id))
      if (at >= 0) {
        if (backup) rows.value.splice(at, 1, backup)
        else rows.value.splice(at, 1)
      }
    } else {
      const at = rows.value.findIndex((row) => String(row.id) === String(tempId))
      if (at >= 0) rows.value.splice(at, 1)
    }
    saveError.value = err.message
    setStatus('error', `保存失败：${err.message}`)
    // 回滚后与扩展对账：扩展可能已写库（如「连接已保存，但密码未保存」），不能只信本地回滚
    await reconcile()
  } finally {
    saving.value = false
  }
}

function openConnection(row) {
  const id = row.id
  // 静默去重：1 秒内的重复点击**直接返回**——不派发、不改界面、不写日志（见 src/dedup.js）
  if (openDedup.shouldIgnore(id)) return
  callExtension('open', { id })
    .then((data) => {
      // 不再读 data.pid：经 cmd /c start 派发拿不到 pid（见 docs/adr/0003）。
      // "已派发"不等于"已连上"——所以文案只承诺派发（spec §4 第 4 条）。
      setStatus('ok', `已通过 shell 打开 ${titleOf(row)}${warningSuffix(data)}`)
    })
    .catch((err) => {
      setStatus('error', `打开 ${titleOf(row)} 失败：${err.message}`)
    })
}

function askDelete(row) {
  rememberTrigger()
  deleteRow.value = row
}

function closeDelete() {
  deleteRow.value = null
  restoreFocus()
}

async function confirmDelete() {
  const row = deleteRow.value
  if (!row) return
  const id = row.id
  deleting.value = true
  const index = rows.value.findIndex((item) => String(item.id) === String(id))
  const backup = index >= 0 ? rows.value[index] : null
  if (index >= 0) rows.value.splice(index, 1)
  try {
    const result = await callExtension('remove', { id })
    openDedup.forget(id) // 该 id 已消失，别让它把将来（万一复用）的点击挡在窗口外
    setStatus('ok', `已删除 ${titleOf(row)}，并清理本机保存的凭据${warningSuffix(result)}`)
  } catch (err) {
    if (backup && index >= 0) rows.value.splice(index, 0, backup)
    setStatus('error', `删除 ${titleOf(row)} 失败：${err.message}`)
    await reconcile()
  } finally {
    deleting.value = false
    deleteRow.value = null
    restoreFocus()
  }
}

/** 清空搜索（搜索框上的 Esc）：查询为空 ⇒ computed 直接回到"全部连接、新→旧" */
function clearSearch() {
  searchQuery.value = ''
}

onBeforeUnmount(() => {
  openDedup.clear()
})

refresh()
</script>

<template>
  <div class="app">
    <header class="app__header">
      <div class="app__title">
        <h1 class="app__heading">远程桌面</h1>
        <span class="badge">{{ connectionsText }}</span>
      </div>
      <button
        ref="createButton"
        type="button"
        class="btn btn--primary"
        aria-label="新建连接"
        @click="openCreate"
      >
        ＋ 新建连接
      </button>
    </header>

    <main class="app__content">
      <p v-if="loading" class="app__loading">正在加载连接…</p>
      <EmptyState v-else-if="rows.length === 0" @create="openCreate" />
      <template v-else>
        <!-- 搜索框（v1.0.1 引入；v1.0.2 美化形态）：只在确实有连接时出现；输入即过滤，Esc 清空 -->
        <div class="search">
          <div class="search__field">
            <!-- 放大镜：描边取 currentColor（色由 CSS 的 token 决定，不在这里写色值） -->
            <svg class="search__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle
                cx="6.5"
                cy="6.5"
                r="4.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M10 10l4.2 4.2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              class="input search__input"
              placeholder="搜索名称 / 地址 / 用户名"
              aria-label="搜索连接"
              @keydown.esc="clearSearch"
            />
          </div>
        </div>
        <EmptyState
          v-if="searching && visibleRows.length === 0"
          title="没有匹配的连接"
          hint="换个关键词试试；按 Esc 清空搜索框即可恢复全部连接"
          :show-action="false"
        />
        <div v-else class="app__grid">
          <ConnectionCard
            v-for="row in visibleRows"
            :key="row.id"
            :row="row"
            :title="titleOf(row)"
            :subtitle="subtitleOf(row)"
            @open="openConnection(row)"
            @edit="openEdit(row)"
            @delete="askDelete(row)"
          />
        </div>
      </template>
    </main>

    <ConnectionModal
      v-if="modalOpen"
      :mode="modalMode"
      :row="modalRow"
      :rows="rows"
      :submitting="saving"
      :error="saveError"
      @close="closeModal"
      @save="saveConnection"
    />

    <DeleteConfirm
      v-if="deleteRow"
      :title="titleOf(deleteRow)"
      :submitting="deleting"
      @close="closeDelete"
      @confirm="confirmDelete"
    />
  </div>
</template>
