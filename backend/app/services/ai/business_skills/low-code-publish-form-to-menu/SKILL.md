---
name: low-code-publish-form-to-menu
description: "在用户明确需要旧表单入口时发布标准表单并挂载。通用页面使用页面发布和菜单工具。"
compatibility: 需要连接 ManuFoundry，并由平台提供有权使用的业务工具。
metadata:
  version: "1.1.0"
  manufoundry-registry-id: "low_code.publish_form_to_menu"
---

# 发布兼容的旧表单入口

1. 需要交付通用页面时，先按通用页面技能核对已发布页面及其数据表单，再通过 `menus.create_entry` 传 `page_code` 挂载。用户明确要求保留旧表单入口时，用 `platform.form_settings.query` 核对标准业务表单，用 `platform.application_settings.query` 定位已发布或启用的应用，再核对目标分组或根菜单。
2. 用 `platform.tools.describe` 加载 `forms.publish_to_menu`，再用 `platform.tools.invoke` 提交表单和应用 ID，按需提供分组 ID 和菜单名称。平台核对目标位置，并在需要首次发布时检查发布阻塞项。
3. 用户核对表单、菜单位置和是否需要发布后确认。已有发布版本与对应入口可复用。表单和菜单的写入回执只证明这两项操作成功。交付后从应用菜单核对页面内容和新增入口。如果入口打开空白画布，按通用页面技能配置业务列表、数据源与新增操作，发布页面，再将菜单指向该页面并复验。

## 使用示例

> 保留整改跟踪表的旧表单入口，把它挂到生产巡检应用的根菜单。
