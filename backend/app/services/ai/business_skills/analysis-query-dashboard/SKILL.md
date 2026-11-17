---
name: analysis-query-dashboard
description: "按已发布页面的组件口径、数据权限和筛选条件查询结果，兼容已发布的旧版看板。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.1.0"
  manufoundry-registry-id: "analysis.query_dashboard"
---

# 查询已发布分析页面或看板

1. 确认要看的页面、指标和筛选范围。通用页面使用 `pages.list` 定位，然后通过 `pages.query` 传入 `page_code` 和可选的 `query`，参数以工具定义为准。仍在运行的旧版看板可使用 `dashboards.query`。
2. 按已发布组件的指标口径和数据权限解释结果。页面尚未发布、数据来源异常或结果为空时，按实际回执说明。
3. 全程只读，无需提交写入确认。

## 使用示例

> 查巡检看板本月各班组的问题数量。
