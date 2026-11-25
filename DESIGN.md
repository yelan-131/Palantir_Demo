---
name: ManuFoundry
description: 制造业数据工作区的颜色卡设计体系（默认石墨 · 信号橙）
colors:
  # 默认颜色卡 graphite；其余颜色卡见 frontend/src/theme/cards.ts
  accent: "#C9420F"
  accent-active: "#A9370B"
  indicator: "#E5531A"
  canvas: "#F3F2EF"
  surface: "#FFFFFF"
  rail: "#15171B"
  side: "#1D2025"
  text: "#1A1C20"
  text-2: "#3F4248"
  muted: "#64686F"
  border: "#E6E3DE"
  focus: "#C9420F"
typography:
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
  numeric: "Bahnschrift, 'DIN Alternate', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
  mono: "'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, 'Microsoft YaHei UI', monospace"
  display: { fontSize: "34px", lineHeight: "36px", fontWeight: 600 }
  title: { fontSize: "26px", lineHeight: "32px", fontWeight: 600 }
  heading: { fontSize: "20px", lineHeight: "28px", fontWeight: 600 }
  section: { fontSize: "16px", lineHeight: "24px", fontWeight: 600 }
  body: { fontSize: "14px", lineHeight: "22px", fontWeight: 400 }
  control: { fontSize: "13px", lineHeight: "20px", fontWeight: 400 }
  caption: { fontSize: "12px", lineHeight: "18px", fontWeight: 400 }
rounded:
  tag: "4px"
  control: "6px"
  panel: "10px"
  overlay: "14px"
controlHeight:
  small: "28px"
  middle: "32px"
  large: "40px"
icons:
  library: "lucide-react"
  strokeBySize: { "12": 2, "14": 1.85, "16": 1.75, "20": 1.6, "24": 1.5, "32": 1.3 }
spacing:
  small: "8px"
  medium: "12px"
  section: "16px"
  panel: "24px"
---

## Overview

2026-11-25 起界面改为颜色卡体系，分 5 个阶段落地：基础（颜色卡、主题切换、图标组件、字体规范）→ 外壳与设置 → 高频页面 → 全站图标替换与尺度收敛 → 暗色卡。本文描述目标规范；未迁移的页面仍可能使用旧写法，不表示全站已完成审计。

## Colors

代码来源是 `frontend/src/theme/cards.ts`。每张颜色卡定义同一组颜色角色，根组件 `ThemeCardProvider` 按个人偏好把它们写到页面根节点：

- `--ui-*`：颜色卡专属变量，例如应用栏 `--ui-rail-*`、二级导航 `--ui-side-*`、顶栏 `--ui-header-bg`、当前位置刻线 `--ui-indicator`。
- `--mf-*`、`--canon-*`：既有页面使用的旧变量名，继续由颜色卡输出，旧页面不改代码也会随颜色卡变化。
- Ant Design 组件颜色由 `theme/antTheme.ts` 按颜色卡生成。列表、筛选和组件框架用 `CanonThemeScope` 取得同一颜色卡的紧凑变体。

| 颜色卡 | 状态 | 特点 |
|---|---|---|
| 石墨 · 信号橙 `graphite` | 默认 | 深色应用栏和导航框住浅色工作区，橙色只用于主要操作、选中和当前位置 |
| 瓷白 · 钴蓝 `porcelain` | 可选 | 全浅色，选中项为钴蓝实底 |
| 松林 · 黄铜 `pine` | 可选 | 深松绿应用栏、米色导航，黄铜色只做刻线 |
| 浅雾蓝 `mist` | 可选 | 原有灰蓝体系，保留给习惯旧界面的用户 |
| 控制室 `control-room` | 规划中 | 全暗界面，第 5 阶段清理写死颜色后开放 |

规则：

- 正文与背景对比度不低于 4.5:1，图标和焦点框不低于 3:1；`frontend/tests/themeCards.test.cjs` 对每张颜色卡逐项校验。
- 主色只用于主要操作、链接、选中和焦点，不做大面积底色。状态色只表达业务状态，不用于装饰。
- 进行中的状态（审批中、维护中、进行中）用信息色，不用主色，避免在石墨卡下与警告橙混淆。列表主列链接用正文色，悬停时显示主色和下划线。
- 文字分四级：正文 `text`、次要正文 `text2`、辅助 `muted`、禁用 `disabled`。
- 新代码不写十六进制颜色，使用变量或 Ant token；旧个人偏好里的 `tech-white` 视为未选择，落到默认颜色卡。

## Typography

代码来源是 `frontend/src/theme/cards.ts` 的 `UI_TYPE`，所有颜色卡共用同一套字体规范，输出为 `--ui-font-*` 和 `--ui-text-{角色}-size/line/weight/tracking` 变量；页面可直接使用 `.ui-text-{角色}`、`.ui-num`、`.ui-mono`。

字体只用三套，均为系统字体，不加载网络字体：

- 正文 `sans`：Windows 中文落到微软雅黑 UI，比微软雅黑行距更紧凑，适合界面；macOS 用苹方。
- 数字 `numeric`：Bahnschrift（Windows 自带）用于指标大数字、计数、编号、时间，统一等宽数字（tabular-nums）。表格默认等宽数字，列内数字上下对齐。
- 等宽 `mono`：代码、SQL、JSON、接口路径、内部编码，取代现有 6 套不同写法。

| 角色 | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| display | 34 / 36 | 600 | 指标大数字，仅用数字字体 |
| title | 26 / 32 | 600 | 页面标题、工作台问候、登录标题 |
| heading | 20 / 28 | 600 | 弹窗标题、详情分区 |
| section | 16 / 24 | 600 | 卡片标题、侧栏应用名 |
| body | 14 / 22 | 400 | 正文、表格、表单输入 |
| control | 13 / 20 | 400 / 500 | 按钮、菜单、紧凑表格 |
| caption | 12 / 18 | 400 | 辅助说明、表头、标签、时间 |

规则：

- 最小字号 12px，包括徽标计数和图表坐标轴。
- 字重只用 400 / 500 / 600。微软雅黑只有常规和粗体，Windows 上 500 与 400 看起来一样、600 以上都是粗体，所以层级靠字号和文字颜色区分，不靠 500 与 600 的差别。
- 行高落在 2px 网格；20px 以下的中文行高不低于字号的 1.4 倍。
- 中文不加字间距；只有 display 和 title 收紧（-0.02em / -0.01em）。
- 文字颜色分四级：正文、次要正文、辅助、禁用，见颜色卡定义。

现状与迁移：第 4 阶段已把应用代码中 8–11px 的字号统一提到 12px，非 400/500/600 的字重改为 600（550 改为 500）；`frontend/tests/typographyGuard.test.cjs` 现在要求这两项为零。工作偏好里的界面缩略预览是按比例缩小的示意图，所在行以 `type-exempt` 注释标明后不计入；`src/design-review`、`src/design-preview` 是独立的设计评审原型（`ui-review.html`、`unified-form-design.html`），不进入应用构建，也不计入。工作台、业务列表、账号设置等页面级标题已改用 title 角色（26/32），记录详情抽屉标题用 heading（20/28）；`--mf-font-title` 与 Ant 三级标题仍为 22px，供尚未迁移的页面和文档标题使用。组件页面中组件框架的标题字号由组件属性配置，不受此规范覆盖。`<body>` 暂不设置字号与行高，避免现有布局整体移位。

## Layout

外壳结构不变：左侧应用栏、二级导航、顶部搜索栏。应用栏当前项用左侧 3px 刻线标记，二级导航选中项同样带刻线。沿用应用导航与工作区框架。相关控件成组，筛选与结果分区；桌面按可用宽度排列筛选字段，窄屏改为单列。宽表格在表格内部滚动，筛选内容不能因固定高度无法访问。

## Elevation & Depth

以留白、浅底和细边框区分层次。工作区面板无阴影；下拉菜单和气泡用 `--ui-shadow-popover`，弹窗用 `--ui-shadow-modal`。组件的融入页面、浅底分区、独立卡片设置继续由既有配置控制。

## Shapes

圆角四档：标签 4px、控件 6px、面板 10px、弹窗 14px；全圆角（999px 或 50%）只用于状态胶囊、滑轨、头像和圆点。第 4 阶段已把其余取值就近归档（1–5→4、6–7→6、8–12→10、13 以上→14），同一字体守卫检查圆角，淘宝风格原型页 `TaobaoPrototype` 有意模仿消费端外观，不在检查范围内。控件高度 28 / 32 / 40px，常规 32px。动效 120ms（悬停、按下）与 180ms（展开、切换），曲线 `cubic-bezier(.2,.8,.2,1)`，尊重减少动态效果设置。不套用营销页面的渐变或装饰性动效。

## Icons

图标库为 Lucide（`lucide-react`），通过 `frontend/src/components/Icon` 使用：

- `Icon` 按尺寸自动配线宽：12px 用 2，14px 用 1.85，16px 用 1.75，20px 用 1.6，24px 用 1.5，32px 用 1.3。正文和按钮内 16px，应用栏 20px，空状态 32px。
- 图标默认只作装饰（`aria-hidden`），可点击的图标按钮必须有可访问名称。
- `AppIcon` 渲染应用和菜单图标。数据库、种子数据和个人偏好里存的 Ant Design 名称（如 `DashboardOutlined`）保持原样，由 `iconNames.ts` 映射到 Lucide，无需数据迁移；未知名称显示通用应用图标。
- 应用代码不再直接引用 `@ant-design/icons`。原有写法通过兼容层 `@/components/Icon/ant` 保留 Ant 名称（如 `PlusOutlined`），内部渲染对应的 Lucide 图标，线宽 1.75、尺寸随文字（1em），支持 `spin` 与 `rotate`；`Filled` 图标用实心或镂空填充。新代码优先直接用 `Icon` 与 Lucide 名称。`frontend/tests/iconGuard.test.cjs` 阻止重新引入 `@ant-design/icons`，并检查兼容层每个名称都对应一个 Lucide 图标。Ant 组件内置的箭头、分页等图标保留。

## Components

- 使用 Ant Design，保持按钮、输入框、表格、下拉菜单风格一致。
- 独立业务列表操作显示文字；嵌入组件标题栏保留紧凑图标，配有可访问名称。
- 加载中明确显示加载状态；区分无记录、筛选无结果和加载失败，保留配置提供的自定义空状态。空状态与错误状态使用 `components/StateBlock`：图标块（暂无记录、无匹配、加载失败、无权限四种）、section 级标题、control 级说明和可选操作。加载失败优先于自定义空状态显示，并提供重试。
- 按钮权限和只读行为仍由现有逻辑控制；键盘焦点必须可见。
- 应用布局提供“跳转到页面内容”入口；路由加载以带状态说明的骨架展示，尊重减少动态效果设置。
- 登录页左侧介绍区使用颜色卡的导航底色，顶部为品牌行（MF 品牌标 + ManuFoundry 制造数智平台），右侧表单直接放在画布上，不加卡片边框、渐变或模糊。不展示未登录时无法取得的统计数字。900px 以下上下排列，600px 以下只保留品牌行和登录表单。
- 应用栏顶部为 36px 品牌标（`--ui-brand`）；账号入口使用中性底色，橙色只用于主要操作和当前位置刻线。
- 布局有“经典分栏”（默认）和“悬浮画布”两种，在工作偏好中选择。悬浮画布以导航底色作外框，工作区留 8px 间距、14px 圆角和浮层阴影；900px 以下与知识库工作区始终使用经典分栏。
- 应用和数据源读取失败显示持久的错误与重试入口，成功读取但无数据时才显示空状态。

## Do's and Don'ts

先评审一个具体页面，再在代码中修改并查看桌面与窄屏渲染。不要仅依赖检测分数，不要把模拟数据验收描述为生产验收；不改变事实文案、权限规则或已发布配置语义。
