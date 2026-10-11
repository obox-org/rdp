<script setup>
/** 空态（设计 §3.9.1）：居中图标 + 一句话 + 副文案 + 主按钮。 */
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
    <p class="empty__title">还没有远程连接</p>
    <p class="empty__hint">新建一条连接，填好主机和账号，之后点「打开」即可发起远程桌面</p>
    <button type="button" class="btn btn--primary" @click="emit('create')">新建第一条连接</button>
  </div>
</template>
