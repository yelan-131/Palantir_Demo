---
name: analysis-manage-dashboard
description: "搭建指标和图表时使用通用页面技能。支持读取及维护仍在运行的旧版看板配置。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.1.0"
  manufoundry-registry-id: "analysis.manage_dashboard"
---

# 搭建分析页面和维护已有看板

1. 新建看板时使用通用页面技能。先核对数据表单、字段及统计口径，使用 `metric` 和 `chart`，按需要加入业务列表和筛选。保存、发布、挂载都沿用通用页面流程。
2. 编辑已有看板时，先用 `pages.list` 或当前画布上下文定位页面，用 `pages.get` 读取版本和组件。需要调整时使用通用页面工具。
3. 用户明确要维护仍在运行的旧版看板定义时，可用 `dashboards.get` 定位旧配置，再按其工具定义准备保存或发布。两套配置分别有自己的版本，参数以实际回执为准。

## 使用示例

> 用巡检记录做一张看板，展示每日巡检量和问题分类。
