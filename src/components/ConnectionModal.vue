<script setup>
/**
 * 新建 / 编辑连接模态框（设计 §3.9.2）。
 * 表单受控：值在本地 reactive form 上，校验通过后 emit save(payload)，提交中的 loading 由父级回传。
 *
 * **关闭路径只有按钮**（R-D4 的用户要求）：点遮罩、按 Esc 都**不**关闭——只有右上「✕」「取消」
 * 「保存成功」三条路径。守卫见 test/componentSource.test.js（源码门禁：不得再出现
 * `@mousedown.self` 关闭或 keydown/Esc 关闭）。
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import ConnectionField from './ConnectionField.vue'
import { callExtension } from '../bridge.js'
import {
  ADVANCED_GROUPS,
  COMMON_GROUPS,
  buildSavePayload,
  defaultForm,
  isFieldVisible,
  rowToForm,
  validate
} from '../fields.js'

const props = defineProps({
  /** create | edit */
  mode: { type: String, default: 'create' },
  row: { type: Object, default: null },
  /** 现有连接列表，用于「连接名唯一」校验 */
  rows: { type: Array, default: () => [] },
  submitting: { type: Boolean, default: false },
  /** 父级回传的保存失败原因 */
  error: { type: String, default: '' }
})

const emit = defineEmits(['close', 'save'])

/**
 * 表单以 `defaultForm()` 建空壳，再由 props.row 同步（修法 1）：**props 是唯一真源**，
 * 正确性不再依赖父级是否重建组件。`rowToForm` 每次都产出完整表单，故用 Object.assign 覆盖；
 * 新建（row 为 null）时必须清掉可能残留的 id，否则会把"新建"当成"更新"提交。
 *
 * **密码回填**（本次新增）：库行里没有密码（它在宿主 `api.secrets`，键 `conn:<id>`），所以
 * `rowToForm` 对密码框一律置空——那正是"新建/无 id"路径的语义，不改。编辑时改走**另一条路**：
 * 向扩展要 `password`（见 index.js），拿到什么填什么；新建**不调用**它。
 *
 * `storedPassword` 是**打开时读到的原值**，只交给 `buildSavePayload` 用来区分「没动」与「清空」：
 * 读不到 / 读取失败 ⇒ `''`（= 未知），此时绝不触发"清空即删除已存密码"。
 */
const form = reactive(defaultForm())
/** 打开时从 `api.secrets` 读到的密码原值（`''` = 没有 / 读失败 = 未知，两种都不删） */
let storedPassword = ''
/** 竞态令牌：row 连续切换时只认最后一次请求的结果 */
let passwordToken = 0
watch(
  () => props.row,
  async (row) => {
    const token = ++passwordToken
    Object.assign(form, rowToForm(row))
    storedPassword = ''
    const id = row?.id
    if (id === undefined || id === null || id === '') {
      // 新建：不请求密码（调用点必须在 rowToForm 之后、且在这个分支之后）
      delete form.id
      return
    }
    try {
      const data = await callExtension('password', { id })
      if (token !== passwordToken) return
      storedPassword = String(data?.password ?? '')
    } catch {
      if (token !== passwordToken) return
      // 读不到密码**不阻断编辑**（扩展侧也不报错）：保持空串（= 未知），用户重新输入即可
      storedPassword = ''
    }
    // 默认仍是掩码——明文只在用户点「显示密码」时才出现（ConnectionField.vue 的 passwordVisible）
    form.password = storedPassword
  },
  { immediate: true }
)
/** 动过表单（或提交过）才把红字铺出来，避免一打开就满屏红 */
const dirty = ref(false)
const submitted = ref(false)
const advancedOpen = ref(false)
const panel = ref(null)

const title = computed(() => (props.mode === 'edit' ? '编辑连接' : '新建连接'))

/** 按当前表单过滤字段：可见性判定与 `buildSavePayload` 的提交范围**同源**（fields.js 的纯函数） */
function visibleFields(group) {
  return group.fields.filter((field) => isFieldVisible(field, form))
}

/** 实时校验：有错时「保存」禁用（§3.9.2） */
const liveErrors = computed(() => validate(form, props.rows))
const hasErrors = computed(() => Object.keys(liveErrors.value).length > 0)

/** 实际显示的字段错误 */
const errors = computed(() => (submitted.value || dirty.value ? liveErrors.value : {}))

function onChange(key, value) {
  form[key] = value
  dirty.value = true
}

function submit() {
  if (props.submitting) return
  submitted.value = true
  if (hasErrors.value) {
    nextTick(() => {
      panel.value?.querySelector('.field__error')?.scrollIntoView({ block: 'nearest' })
    })
    return
  }
  emit('save', buildSavePayload(form, { storedPassword }))
}

function onEnter(event) {
  if (event.isComposing) return
  const tag = event.target?.tagName
  // 按钮/下拉的 Enter 交给原生行为，避免与点击重复触发
  if (tag === 'BUTTON' || tag === 'TEXTAREA') return
  submit()
}

onMounted(() => {
  nextTick(() => {
    // 打开时焦点落到第一个输入（§3.9.5）
    const first = panel.value?.querySelector('input, select')
    first?.focus()
  })
})
</script>

<template>
  <div class="overlay">
    <form
      ref="panel"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rdp-modal-title"
      @submit.prevent="submit"
      @keydown.enter="onEnter"
    >
      <header class="modal__header">
        <h2 id="rdp-modal-title" class="modal__title">{{ title }}</h2>
        <button
          type="button"
          class="modal__close"
          aria-label="关闭"
          :disabled="submitting"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <div class="modal__body">
        <p v-if="error" class="alert alert--error">保存失败：{{ error }}</p>

        <section v-for="group in COMMON_GROUPS" :key="group.title" class="form-group">
          <h3 class="form-group__title">{{ group.title }}</h3>
          <div class="form-rows">
            <ConnectionField
              v-for="field in visibleFields(group)"
              :key="field.key"
              :field="field"
              :form="form"
              :error="errors[field.key] || ''"
              :required="!!field.required"
              @change="onChange"
            />
          </div>
        </section>

        <div class="accordion">
          <button
            type="button"
            class="accordion__toggle"
            :aria-expanded="advancedOpen"
            aria-controls="rdp-advanced-body"
            @click="advancedOpen = !advancedOpen"
          >
            <span aria-hidden="true">{{ advancedOpen ? '▾' : '▸' }}</span>
            高级选项
          </button>
          <div v-show="advancedOpen" id="rdp-advanced-body" class="accordion__body">
            <section v-for="group in ADVANCED_GROUPS" :key="group.title" class="form-group">
              <h3 class="form-group__title">{{ group.title }}</h3>
              <div class="form-rows">
                <ConnectionField
                  v-for="field in visibleFields(group)"
                  :key="field.key"
                  :field="field"
                  :form="form"
                  :error="errors[field.key] || ''"
                  :required="!!field.required"
                  @change="onChange"
                />
              </div>
            </section>
          </div>
        </div>
      </div>

      <footer class="modal__footer">
        <button type="button" class="btn" :disabled="submitting" @click="emit('close')">
          取消
        </button>
        <button type="submit" class="btn btn--primary" :disabled="submitting || hasErrors">
          <span v-if="submitting" class="spinner" aria-hidden="true"></span>
          {{ submitting ? '保存中…' : '保存' }}
        </button>
      </footer>
    </form>
  </div>
</template>
