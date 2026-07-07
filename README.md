# 投放效果分析看板

Meta 与 AppLovin 双平台统一看板，单一入口 `index.html`，顶部 Tab 切换平台，通过开始/结束日期筛选数据。

## 素材标签 Token

标签在线保存需要 GitHub Fine-grained PAT（`ad-dashboard` 仓库 **Contents 读写**）。

1. 打开看板，在右上角 **登录** 行下方找到 **GitHub Token** 输入框
2. 粘贴 PAT 后会自动保存到本机 `localStorage`，刷新页面无需重新输入
3. 显示「标签可编辑」后即可在生命周期表格点击添加标签

Token 仅存于本机浏览器，不会写入仓库代码。
