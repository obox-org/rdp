import { createApp } from 'vue'
import App from './App.vue'
import { installThemeBridge } from './theme.js'

// 必须在 mount 之前：installThemeBridge 会**同步**把兜底 token 写到 documentElement（首帧即有配色），
// 随后接收宿主的主题推送（协议见 src/theme.js 顶部注释）。顺序不能反。
//
// 样式全部来自宿主组件库 `app://obox/ui.css`（`index.html` 里 link 引入，组件只用 `obox-*` class），
// 本扩展**不再带自己的样式表**——通用外观（按钮/输入/卡片/弹窗/空态）由宿主统一供给。
installThemeBridge()

createApp(App).mount('#app')
