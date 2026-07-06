# 投放效果分析看板

Meta 与 AppLovin 双平台统一看板，单一入口 `index.html`，顶部 Tab 切换平台，通过开始/结束日期筛选数据。

## 功能

- **双平台**：Meta / AppLovin 顶部切换，各自独立筛选
- **Meta 看板**：优化师筛选、账号漏斗、ROAS KPI、素材生命周期等
- **AppLovin 看板**：Creative Set 维度、国家漏斗、D0/D7 ROAS 等
- **权限**：Meta 核心 KPI/漏斗需登录（优化师有数据范围）；AppLovin 漏斗/素材公开，**核心 KPI/趋势仅 admin**
- **按需加载**：首次仅加载**本月 + 上月**数据；当日期筛选涉及更早月份时再自动拉取对应 JSON

## 快速启动
