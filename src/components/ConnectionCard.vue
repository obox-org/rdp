<script setup>
/**
 * 连接卡片（设计 §3.9.1）：标题 user@host:port（等宽、单行省略 + title 全量）、副行、按钮行，
 * 右上角状态点：默认灰 / 打开中蓝脉冲 / 成功绿（2s 后回灰，由父级定时）/ 失败红并保留，点它看错误原文。
 */
import { computed } from 'vue'

const props = defineProps({
  row: { type: Object, required: true },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  /** idle | opening | ok | error */
  state: { type: String, default: 'idle' },
  /** 失败时的错误原文（有值时状态点可点击展开） */
  error: { type: String, default: '' },
  /** 是否已展开错误原文 */
  showError: { type: Boolean, default: false }
})

const emit = defineEmits(['open', 'edit', 'delete', 'toggle-error'])

const stateLabel = computed(
  () =>
    ({
      idle: '未连接',
      opening: '正在打开',
      ok: '已打开',
      error: '打开失败'
    })[props.state] || '未连接'
)

const dotLabel = computed(() =>
  props.error ? `${stateLabel.value}：${props.error}（点击查看）` : stateLabel.value
)
</script>

<template>
  <article class="card">
    <button
      v-if="error"
      type="button"
      class="dot"
      :class="`dot--${state}`"
      :aria-label="dotLabel"
      :aria-expanded="showError"
      :title="error"
      @click="emit('toggle-error')"
    ></button>
    <span v-else class="dot" :class="`dot--${state}`" :title="stateLabel" aria-hidden="true"></span>

    <h3 class="card__title" :title="title">{{ title }}</h3>
    <p class="card__subtitle">{{ subtitle }}</p>

    <p v-if="error && showError" class="card__error">{{ error }}</p>

    <div class="card__actions">
      <button
        type="button"
        class="btn"
        :aria-label="`打开 ${title}`"
        :disabled="state === 'opening'"
        @click="emit('open')"
      >
        打开
      </button>
      <button type="button" class="btn" :aria-label="`编辑 ${title}`" @click="emit('edit')">
        编辑
      </button>
      <button type="button" class="btn" :aria-label="`删除 ${title}`" @click="emit('delete')">
        删除
      </button>
    </div>
  </article>
</template>
