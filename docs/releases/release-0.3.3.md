# ManuFoundry / Palantir Demo 0.3.3 发布说明

Release date: 2026-05-28

## 背景

0.3.3 修正了服务器前端部分应用页仍显示前端静态示例数据的问题。生产总览、设备健康、质量分析、供应链总览已经是独立动态页面；本次重点处理 `/program/line-status`、`/program/production-plan-entry` 和 `/program/alert-center` 这类低代码应用页。

## 变更

- 新增 `GET /api/v1/dashboard/programs/{program_id}`。
- `line-status` 从 `production_lines`、`workshops`、`equipment` 聚合产线指标和明细。
- `production-plan-entry` 从 `work_orders`、`sales_orders`、`products`、`production_lines` 读取计划明细。
- `alert-center` 从低健康度设备和质量缺陷记录生成告警列表。
- 生产、设备、质量、SPC、供应商和物料影响类 `/program/*` 页面也接入同一数据桥，避免未支持页面静默回退为纯前端示例。
- 前端应用页优先读取服务器接口，接口不可用时才回退到内置示例行。

## 数据口径

服务器生产环境应使用 PostgreSQL。当前大批量制造业种子数据由 `scripts/reseed_business_data.py` 加载，覆盖工厂、车间、产线、设备、传感器、产品、工单、质检、缺陷和传感器读数等表。GitHub 仓库只保留脚本和 JSON seed 文件，不提交 `.db`、`.sqlite`、WAL 或 SHM 数据库文件。

## 验证

部署后至少验证：

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/api/v1/release/current
curl -fsS "http://127.0.0.1:8000/api/v1/dashboard/programs/line-status?limit=5"
curl -I http://111.229.172.100
```

预期版本为 `0.3.3`，`dashboard/programs/line-status` 返回 `source: "database"` 且 `rows` 来自服务器数据库。
