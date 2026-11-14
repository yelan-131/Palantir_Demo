# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

面向所有人员使用，按账号角色、组织、租户与权限显示可用内容和操作。用户于 2026-11-10 确认“所有的人员”；具体角色的使用频率和设备分布尚未确认。

## Product Purpose

ManuFoundry 是制造业低代码数据工作区原型，包含业务数据查询和录入、表单与应用配置、审批、知识资产、分析与 AI 辅助配置。现阶段处于演示与产品探索阶段（依据 README.md）。

## Capabilities and Constraints

- 沿用 React 18、TypeScript、Vite、Ant Design 5 和现有后台接口。
- 界面优化保留业务规则、权限校验、已发布表单和页面配置的语义。
- 普通业务页面优先让使用者找到数据、理解状态、完成操作；配置人员需要保留设计器和发布入口。
- 组件页面的标题、密度、外观和操作配置由现有页面配置决定；局部优化不得强制覆盖这些选择。
- 用户未要求部署时，改动保持本地；验收结果区分模拟数据组件验证与真实后端验证。

## Evidence on Hand

README.md；frontend/package.json；frontend/src/App.tsx；frontend/src/pages/DynamicPage/index.tsx；用户于 2026-11-10 确认的使用人群。
