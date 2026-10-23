# ManuFoundry 0.3.15 — HTTP 业务表单渲染修复

日期：2026-10-23

## 问题与原因

用户报告服务器业务表单 `/dynamic/61` 无法打开。服务健康且表单配置接口返回 HTTP 200；前端在挂载 `FormImport` 时无条件调用 `crypto.randomUUID()`，即使导入弹窗关闭也会执行。公网 HTTP 环境不提供该方法，导致 `TypeError: crypto.randomUUID is not a function`，业务表单无法完成渲染。

## 修复

- 增加共享 UUID 工具：可用时调用原生实现，否则使用 HTTP 环境可用的 `crypto.getRandomValues` 生成 RFC 4122 v4 UUID；不使用弱随机数生成导入幂等键。
- 导入、附件上传、默认值规则、视图页签、编码规则、分析数据集、模型服务和交互原型中的无条件调用改用该工具。
- 继续保留同一导入批次重试时的请求键语义。
- 沿用发布清单、历史记录及版本更新弹窗逻辑，版本更新为 0.3.15。本次不涉及数据库迁移。

## 验证

- 在只提供 `getRandomValues`、不提供 `randomUUID` 的环境中渲染实际导入组件，修复前稳定复现 TypeError。
- 修复后前端 134 项测试全部通过，生产构建通过；发布脚本历史保留及重复执行测试通过。
- 服务器部署验证结果将在实际完成后补充；浏览器控制连接此前持续超时，未将自动测试等同于完整浏览器验收。

参考：[randomUUID 安全上下文限制](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)、[getRandomValues 的 HTTP 支持](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)。
