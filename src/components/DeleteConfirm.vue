<script setup>
/**
 * 删除确认小模态框（设计 §3.9.3）。
 * 破坏性操作：打开时焦点落在「取消」上，避免 Enter 误删；删除按钮才用危险色实心。
 * 与新建/编辑模态框同一套关闭口径（R-D4）：点遮罩、按 Esc 都不关闭，只能走「取消」「删除」按钮。
 */
import { nextTick, onMounted, ref } from 'vue'

const props = defineProps({
  /** 卡片标题 username@host:port */
  title: { type: String, required: true },
  /** 删除请求进行中 */
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'confirm'])

const cancelButton = ref(null)

onMounted(() => {
  nextTick(() => cancelButton.value?.focus())
})
</script>

<template>
  <div class="obox-modal__mask">
    <div
      class="obox-modal__panel obox-modal__panel--sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rdp-delete-title"
      tabindex="-1"
    >
      <header class="obox-modal__header">
        <h2 id="rdp-delete-title" class="obox-title obox-title--h3">删除连接</h2>
      </header>
      <div class="obox-modal__body">
        <p class="obox-text">确定删除「{{ title }}」？</p>
        <p class="obox-text obox-text--sm obox-text--secondary obox-mt-4">
          同时清理本机为该主机保存的凭据，操作不可恢复
        </p>
      </div>
      <footer class="obox-modal__footer">
        <button
          ref="cancelButton"
          type="button"
          class="obox-btn"
          :disabled="submitting"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="button"
          class="obox-btn obox-btn--danger"
          :disabled="submitting"
          @click="emit('confirm')"
        >
          <span v-if="submitting" class="obox-spinner" aria-hidden="true"></span>
          {{ submitting ? '删除中…' : '删除' }}
        </button>
      </footer>
    </div>
  </div>
</template>
