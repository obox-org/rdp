<script setup>
/**
 * 空态（设计 §3.9.1）：居中图标 + 一句话 + 副文案 + 主按钮。
 *
 * 复用两处（**同一套图标与排版**，只有文案与按钮由 props 决定，不另造第二种空态）：
 * - 一条连接都没有：默认文案 + 「新建第一条连接」，点击 emit `create`（父级开新建模态框）；
 * - 搜索无匹配（v1.0.1 新增）：`title` / `hint` 换成「没有匹配的连接」，`show-action` 关掉
 *   （清空搜索走搜索框自己的 `Esc`，这里不重复给按钮）。
 */
defineProps({
  /** 主文案 */
  title: { type: String, default: '还没有远程连接' },
  /** 副文案（一行提示） */
  hint: { type: String, default: '新建一条连接，填好主机和账号，之后点「打开」即可发起远程桌面' },
  /** 主按钮文案 */
  actionLabel: { type: String, default: '新建第一条连接' },
  /** 是否显示主按钮（搜索无匹配时没有"要新建"的语义） */
  showAction: { type: Boolean, default: true }
})

const emit = defineEmits(['create'])
</script>

<template>
  <div class="empty">
    <svg
      class="empty__icon"
      viewBox="0 0 64 48"
      width="96"
      height="72"
      role="img"
      aria-label="远程桌面"
    >
      <rect
        x="2"
        y="2"
        width="60"
        height="36"
        rx="3"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <path d="M22 44h20M32 38v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path
        d="M12 28h16M12 34h10"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        opacity="0.6"
      />
      <path
        d="M38 14h14v14H38z"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
    <p class="empty__title">{{ title }}</p>
    <p class="empty__hint">{{ hint }}</p>
    <button v-if="showAction" type="button" class="btn btn--primary" @click="emit('create')">
      {{ actionLabel }}
    </button>
  </div>
</template>
