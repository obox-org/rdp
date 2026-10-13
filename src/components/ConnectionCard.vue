<script setup>
/**
 * 连接卡片（设计 §3.9.1）：标题 user@host:port（等宽、单行省略 + title 全量）、副行、按钮行。
 *
 * ⚠️ **1.0.3 起不再有右上角状态点**：灰/蓝/绿/红四态、"打开中"的脉冲与"点开看错误原文"的
 * 展开区已**整体移除**（用户裁定：提示只写控制台）。随之去掉的还有「打开」按钮上的
 * `:disabled="state === 'opening'"`——重复点击改由父级的时间窗**静默去重**（`src/dedup.js`），
 * 界面不加禁用态。取舍见 `docs/adr/0003-mstsc-orphan-launch-via-cmd.md` 与 README §14。
 */
defineProps({
  row: { type: Object, required: true },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' }
})

const emit = defineEmits(['open', 'edit', 'delete'])
</script>

<template>
  <article class="card">
    <h3 class="card__title" :title="title">{{ title }}</h3>
    <p class="card__subtitle">{{ subtitle }}</p>

    <div class="card__actions">
      <button type="button" class="btn" :aria-label="`打开 ${title}`" @click="emit('open')">
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
