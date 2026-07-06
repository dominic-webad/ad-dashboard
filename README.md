# 投放效果分析看板

Meta 与 AppLovin 双平台统一看板，单一入口 `index.html`，顶部 Tab 切换平台，通过开始/结束日期筛选数据。

## 功能

- **双平台**：Meta / AppLovin 顶部切换，各自独立筛选
- **Meta 看板**：优化师筛选、账号漏斗、ROAS KPI、素材生命周期等
- **AppLovin 看板**：Creative Set 维度、国家漏斗、D0/D7 ROAS 等
- **权限**：Meta 核心 KPI/漏斗需登录（优化师有数据范围）；AppLovin 漏斗/素材公开，**核心 KPI/趋势仅 admin**
- **按需加载**：首次仅加载**本月 + 上月**数据；当日期筛选涉及更早月份时再自动拉取对应 JSON
- **素材标签**：生命周期表格支持自定义标签（在线保存、团队共享）；标签筛选框带已用标签下拉

## 素材标签配置

标签数据保存在 `public/fb/creative-tags.json` 与 `public/applovin/creative-tags.json`。

### 在线编辑（团队共享）

1. 在 GitHub 创建 **Fine-grained Personal Access Token**
   - 仓库：`dominic-webad/ad-dashboard`（或你的 fork）
   - 权限：**Contents — Read and write**
2. 线上版已内置 `js/tags-config.js`（含 GitHub Token，push 后即可在线编辑标签）
3. 若需本地单独配置，可复制 `js/tags-config.example.js` 覆盖
4. 部署后，优化师在生命周期表格「标签」列输入即可自动保存；其他人约 30 秒内自动同步

未配置 Token 时标签只读，仍可从静态 JSON 查看。

### 安全说明

Token 写在前端可被查看源码的人提取。请使用最小权限 Fine-grained PAT，泄露后立即在 GitHub 轮换。

