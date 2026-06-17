# 投放效果分析看板

面向广告优化师的投放数据分析网站，数据来源于 `cursor` 文件夹内所有 `.xlsx` 文件（自动汇总）。

## 功能

- **核心指标卡片**：ROAS、消耗、转化量、转化成本、CTR、CPC
- **时间趋势图**：支持按日 / 周 / 月切换粒度，可切换指标
- **素材生命周期**：自动划分测试期、增长期、稳定期、衰退期，衰退素材标红
- **素材效果对比**：柱状图对比 Top N 素材
- **多维筛选**：时间、优化师、账号、国家
- **素材详情弹窗**：查看单个素材每日消耗与 ROAS 变化

## 快速启动

### 1. 更新数据

```bash
# 每日将新 Excel 放入 cursor 文件夹后执行（默认只处理未收录的新文件）
node scripts/convert-xlsx.js

# 需要从头重算所有 Excel 时（例如修正了历史表格）
node scripts/convert-xlsx.js --full
```

**增量更新说明：**

- 脚本会读取 `ad-dashboard/public/data.json` 里已收录的文件名（`meta.sourceFiles`）
- 只转换文件夹里**尚未收录**的 `.xlsx`，合并进现有数据
- 处理完的旧 Excel 可以删除，不影响看板；以后每天只需放入当天新表再运行脚本
- 若某天的 Excel 内容有更正，需把该文件放回文件夹后执行 `--full` 全量重建

### 2. 打开看板

**方式一（推荐）：** 启动本地服务

```bash
node ad-dashboard/serve.js
```

浏览器访问：http://localhost:8080

**方式二：** 部署到 GitHub Pages 后直接访问线上地址

## 数据说明

- 优化师从 Account name 最后一个字段解析（如 `Pingme_Fitness_122570_web2sale_Alina` → Alina）
- 国家来自报表 Country 字段
- 日期展示格式：2026.06.07
