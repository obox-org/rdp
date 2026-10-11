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
  <div class="overlay">
    <div
      class="modal modal--sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rdp-delete-title"
      tabindex="-1"
    >
      <header class="modal__header">
        <h2 id="rdp-delete-title" class="modal__title">删除连接</h2>
      </header>
      <div class="modal__body">
        <p class="modal__text">确定删除「{{ title }}」？</p>
        <p class="modal__hint">同时清理本机为该主机保存的凭据，操作不可恢复</p>
      </div>
      <footer class="modal__footer">
        <button
          ref="cancelButton"
          type="button"
          class="btn"
          :disabled="submitting"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="button"
          class="btn btn--danger"
          :disabled="submitting"
          @click="emit('confirm')"
        >
          <span v-if="submitting" class="spinner" aria-hidden="true"></span>
          {{ submitting ? '删除中…' : '删除' }}
        </button>
      </footer>
    </div>
  </div>
</template>
