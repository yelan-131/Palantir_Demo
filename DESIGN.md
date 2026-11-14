---
name: ManuFoundry
description: 制造业数据工作区的现有灰蓝设计体系
colors:
  primary: "#476791"
  primary-strong: "#344D6B"
  canvas: "#F5F6F7"
  surface: "#FFFFFF"
  rail: "#F1F2F3"
  text: "#252B32"
  muted: "#626C77"
  faint: "#5F7082"
  icon: "#64778C"
  border: "#DFE2E5"
  focus: "#537BC3"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
rounded:
  control: "4px"
  panel: "4px"
spacing:
  small: "8px"
  medium: "12px"
  section: "16px"
  panel: "24px"
---

## Overview

提取自 frontend/src/theme/techWhite.ts、main.tsx、workspace.css 和业务列表实现。现有主题是视觉依据，后续优化延续这一体系；这些文档不表示全站已完成审计。

## Colors

颜色的代码来源是 techWhite.ts，由 SHELL_COLOR_VARIABLES 输出 --mf-* CSS 变量。业务页面优先使用已有变量，品牌色用于主要动作、选择和焦点；成功、警告、失败沿用主题语义色。

辅助文字与占位文字使用 muted，次级说明使用 faint，操作图标使用 icon。全站公共细节集中在 ui-system.css，避免为每个页面追加不同的标题、焦点和控件规则。

## Typography

沿用系统中文无衬线字体。主题正文 14px、辅助信息 12px、章节标题 16px、页面标题 22px。保留现有用户密度设置；表格数字使用等宽数字排列。

## Layout

沿用应用导航与工作区框架。相关控件成组，筛选与结果分区；桌面按可用宽度排列筛选字段，窄屏改为单列。宽表格在表格内部滚动，筛选内容不能因固定高度无法访问。

## Elevation & Depth

以留白、浅底和细边框区分层次。现有工作区面板无阴影；弹窗、菜单沿用 Ant Design 和项目主题。组件的融入页面、浅底分区、独立卡片设置继续由既有配置控制。

## Shapes

基础主题控件和面板圆角均为 4px，常规控件高度 34px。遵循项目现有主题，不套用营销页面的大圆角、渐变或装饰性动效。

## Components

- 使用 Ant Design 和 @ant-design/icons，保持按钮、输入框、表格、下拉菜单风格一致。
- 独立业务列表操作显示文字；嵌入组件标题栏保留紧凑图标，配有可访问名称。
- 加载中明确显示加载状态；区分无记录、筛选无结果和加载失败，保留配置提供的自定义空状态。
- 按钮权限和只读行为仍由现有逻辑控制；键盘焦点必须可见。
- 应用布局提供“跳转到页面内容”入口；路由加载以带状态说明的骨架展示，尊重减少动态效果设置。
- 600px 以下登录页优先显示登录表单；桌面保留现有产品介绍。登录表单作为单一有边框容器，不再叠加整页卡片边框。
- 应用和数据源读取失败显示持久的错误与重试入口，成功读取但无数据时才显示空状态。

## Do's and Don'ts

先评审一个具体页面，再在代码中修改并查看桌面与窄屏渲染。不要仅依赖检测分数，不要把模拟数据验收描述为生产验收；不改变事实文案、权限规则或已发布配置语义。
