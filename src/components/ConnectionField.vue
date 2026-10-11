<script setup>
/**
 * 单个表单控件（按 fields.js 的字段描述渲染）。
 * 只读父级的 form 对象，改动通过 change 事件回传，避免在子组件里改 prop。
 *
 * 结构（设计 §4.1/§4.3 的表单结构 + 本轮"表单对齐"要求）：
 *   `.field` 自身就是**两列栅格**（`--label-w` 固定标签列 + 控件列，见 styles.css），
 *   它的**直接子元素**就是栅格项：
 *     ├─ 第 1 行：`.field__label`（标签列，固定宽 + 左对齐）+ `.field__control`（控件列，左对齐）
 *     └─ 第 2/3 行：`.field__desc` / `.field__error`（**只在控件列内**，与控件左边缘对齐）
 *
 * 三类控件的落位（用户要求"控件也左对齐、防止长度不一"）：
 *   - 文本/数字/密码/下拉：`.field__label` + `.field__control` 各占一格；
 *   - **勾选框**：标签列放一个**空占位**（`.field__label--empty`，`aria-hidden`），方框与其文字
 *     整体落在控件列 ⇒ 方框左边缘与其它控件的左边缘**同一条竖线**；
 *   - **成对字段**（分辨率 宽×高）：两个输入框都在控件列内，从左边缘起等宽排布（`.pair`）。
 *
 * ⚠️ 不得再给"标签 + 控件"套一层 `.field__row` 之类的**嵌套栅格**：那一层会被外层栅格当成
 * "第 1 列的栅格项"，宽度只剩 `--label-w`，内层的控件列直接塌成 0（实测 `144px 0px`）。
 * 守卫见 test/formAlign.test.js 的 A1⑦。
 *
 * 多选一的控件**一律是 `select` 下拉框**（R-D4 的用户要求）：
 *   - 选项文本 = `取值 — 短说明`（`options[].label`），说明不再另占一行、也不再有"当前选值说明行"；
 *   - `options[].desc` 只作为该 `<option>` 的 `title`（悬浮提示）保留，并继续受"每个取值都有说明"的门禁约束；
 *   - 带 `field.optional` 的字段（如网关凭据来源）在最前面多一个空值选项 ⇒ 留空 = 不写该键。
 */
import { computed, ref } from 'vue'

const props = defineProps({
  field: { type: Object, required: true },
  form: { type: Object, required: true },
  error: { type: String, default: '' },
  /** 必填字段标 * */
  required: { type: Boolean, default: false }
})

const emit = defineEmits(['change'])

const passwordVisible = ref(false)
const inputId = `rdp-field-${props.field.key}`

/** 说明行：`hint` 优先于 `desc`（一个字段只占一行灰字，避免两句近义说明叠在一起） */
const desc = computed(() => props.field.hint || props.field.desc || '')

function change(key, value) {
  emit('change', key, value)
}

/**
 * 下拉框改动：空值选项要传 `''`（"不写该键"），不能 `Number('')` 成 0——
 * 0 是 `gatewaycredentialssource` 的合法取值（询问密码），两者必须区分。
 */
function onSelect(event) {
  const raw = event.target.value
  change(props.field.key, raw === '' ? '' : Number(raw))
}
</script>

<template>
  <div class="field" :class="{ 'field--full': field.full }">
    <!-- 勾选框：标签列留空占位（方框落到控件列 ⇒ 与其它控件的左边缘同一条竖线），方框与文字同一行 -->
    <template v-if="field.type === 'check'">
      <span class="field__label field__label--empty" aria-hidden="true"></span>
      <div class="field__control">
        <label class="check" :for="inputId">
          <input
            :id="inputId"
            type="checkbox"
            :checked="!!form[field.key]"
            @change="change(field.key, $event.target.checked)"
          />
          <span>{{ field.label }}</span>
        </label>
      </div>
    </template>

    <template v-else>
      <label class="field__label" :for="inputId">
        {{ field.label }}
        <span v-if="required" class="field__required" aria-hidden="true">*</span>
      </label>

      <div class="field__control">
        <!-- 文本 / 数字 -->
        <input
          v-if="field.type === 'text' || field.type === 'number'"
          :id="inputId"
          class="input"
          :class="{ 'input--error': !!error }"
          :type="field.type === 'number' ? 'number' : 'text'"
          :min="field.min"
          :max="field.max"
          :placeholder="field.placeholder"
          :aria-invalid="!!error"
          :value="form[field.key]"
          @input="change(field.key, $event.target.value)"
        />

        <!-- 密码 + 眼睛切换 -->
        <div v-else-if="field.type === 'password'" class="input-row">
          <input
            :id="inputId"
            class="input"
            :class="{ 'input--error': !!error }"
            :type="passwordVisible ? 'text' : 'password'"
            :placeholder="field.placeholder"
            :aria-invalid="!!error"
            autocomplete="off"
            :value="form[field.key]"
            @input="change(field.key, $event.target.value)"
          />
          <button
            type="button"
            class="btn"
            :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
            :aria-pressed="passwordVisible"
            @click="passwordVisible = !passwordVisible"
          >
            <svg
              v-if="passwordVisible"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <path
                d="M8 3C4.5 3 1.7 5.4 1 8c.7 2.6 3.5 5 7 5s6.3-2.4 7-5c-.7-2.6-3.5-5-7-5Zm0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7Zm0-1.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
                fill="currentColor"
              />
            </svg>
            <svg v-else viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M2 2.7 2.7 2l11.3 11.3-.7.7-2.1-2.1A7.9 7.9 0 0 1 8 13c-3.5 0-6.3-2.4-7-5a8 8 0 0 1 2.6-3.8L2 2.7ZM8 11c.8 0 1.6-.2 2.3-.6L4.6 4.7A6.6 6.6 0 0 0 2.4 8C3.1 9.9 5.3 11 8 11Zm0-7.5c3.5 0 6.3 2.4 7 5a8 8 0 0 1-1.7 2.8l-1.1-1.1A6.4 6.4 0 0 0 13.6 8C12.9 6.1 10.7 5 8 5l-.9.1-.9-.9H8Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <!-- 下拉：选项内自带短说明（取值 — 短说明），更细的一句在该 option 的 title 里 -->
        <select
          v-else-if="field.type === 'select'"
          :id="inputId"
          class="select"
          :class="{ 'select--error': !!error }"
          :aria-invalid="!!error"
          :value="form[field.key]"
          @change="onSelect"
        >
          <option v-if="field.optional" value="">{{ field.emptyLabel || '（留空）' }}</option>
          <option
            v-for="option in field.options"
            :key="option.value"
            :value="option.value"
            :title="option.desc"
          >
            {{ option.value }} — {{ option.label }}
          </option>
        </select>

        <!-- 数值对（分辨率） -->
        <div v-else-if="field.type === 'pair'" class="pair">
          <input
            :id="inputId"
            class="input"
            type="number"
            :min="field.min"
            :max="field.max"
            :aria-label="`${field.label}（宽）`"
            :value="form[field.keys[0]]"
            @input="change(field.keys[0], $event.target.value)"
          />
          <span class="pair__sep" aria-hidden="true">×</span>
          <input
            class="input"
            type="number"
            :min="field.min"
            :max="field.max"
            :aria-label="`${field.label}（高）`"
            :value="form[field.keys[1]]"
            @input="change(field.keys[1], $event.target.value)"
          />
        </div>
      </div>
    </template>

    <p v-if="desc" class="field__desc">{{ desc }}</p>
    <p v-if="error" class="field__error">{{ error }}</p>
  </div>
</template>
