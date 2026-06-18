# 投放效果分析看板

Meta 与 AppLovin 双平台统一看板，单一入口 `index.html`，顶部 Tab 切换平台，通过开始/结束日期筛选数据。

## 功能

- **双平台**：Meta / AppLovin 顶部切换，各自独立筛选
- **Meta 看板**：优化师筛选、账号漏斗、ROAS KPI、素材生命周期等
- **AppLovin 看板**：Creative Set 维度、国家漏斗、D0/D7 ROAS 等
- **权限**：Meta 核心 KPI/漏斗需登录（优化师有数据范围）；AppLovin 漏斗/素材公开，**核心 KPI/趋势仅 admin**
- **按需加载**：首次仅加载**本月 + 上月**数据；当日期筛选涉及更早月份时再自动拉取对应 JSON

## 快速启动

### 1. 每日更新数据

每日将新报表直接放入仓库根目录 `/Users/dominic/Documents/GitHub/ad-dashboard` 后运行转换脚本：

| 平台 | 放入目录 | 文件名格式 |
|------|----------|-----------|
| Meta | `/Users/dominic/Documents/GitHub/ad-dashboard` | `Untitled-report_MMDD.xlsx` |
| AppLovin | `/Users/dominic/Documents/GitHub/ad-dashboard` | `report_YYYY-MM-DD_*.csv` |

```bash
cd /Users/dominic/Documents/GitHub/ad-dashboard

# Meta 增量
node scripts/convert-xlsx.js

# AppLovin 增量
node scripts/convert-applovin-csv.js
```

脚本会更新 `public/{platform}/manifest.json` 与按月 `{YYYY-MM}.json`。已收录文件名记录在 manifest 的 `sourceFiles`，处理完源文件可从仓库根目录移走。

全量重建：

```bash
node scripts/convert-xlsx.js --full
node scripts/convert-applovin-csv.js --full
```

**从旧版单文件迁移**（一次性）：

```bash
node scripts/split-existing.js --platform=fb
node scripts/split-existing.js --platform=applovin
```

### 2. 打开看板

```bash
node serve.js
```

浏览器访问：http://localhost:8080

## 登录

| 用户 | 密码 | Meta 核心数据 | AppLovin 核心数据 |
|------|------|---------------|-------------------|
| admin | enerjoy.life | 全部 | 可见 |
| alina / barry / angie / dom | enerjoy.life | 本人 + Creative | 不可见（漏斗等公开模块仍可看） |

## 目录结构

```
ad-dashboard/
├── index.html
├── js/
├── public/
│   ├── fb/          # manifest.json + 2026-06.json …
│   └── applovin/
└── scripts/
```

## 部署

GitHub Pages 等静态托管可直接部署仓库根目录；确保 `public/fb/` 与 `public/applovin/` 一并上传。
