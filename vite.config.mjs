import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 远程桌面子应用构建（设计 §3.7）：
 * - 源码在 src/，产物输出到扩展根下的 ui/（源码与产物不同目录，emptyOutDir 不会删到源码）；
 * - base:'./'：产物从 app://extensions/<id>/ui/ 加载时资源引用必须是相对路径；
 * - inlineDynamicImports:true：单文件产物，避免 app:// 下动态 import 的额外请求；
 * - format:'iife'：与仓库内另一个用户扩展（extensions/todo）一致，避开 app:// 的模块脚本兼容问题。
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  base: './',
  plugins: [vue()],
  build: {
    outDir: fileURLToPath(new URL('./ui', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true
      }
    }
  }
})
