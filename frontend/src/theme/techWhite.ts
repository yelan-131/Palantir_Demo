/** Shared colors for the shell, Ant Design controls and the visible palette card. */
export const TECH_WHITE_PALETTE = {
  canvas: '#FAFBFC',
  surface: '#FFFFFF',
  rail: '#F7F7F8',
  menu: '#F9F9FA',
  hover: '#F2F3F5',
  selected: '#EDEEF0',
  border: '#E6E8EB',
  borderStrong: '#CBD2DA',
  text: '#202326',
  muted: '#68717D',
  faint: '#929AA4',
  icon: '#989DA3',
  primary: '#526B86',
  primaryStrong: '#394D63',
  success: '#2F7D5B',
  warning: '#A66F1F',
  danger: '#A43D3D',
  successBg: '#EDF6F0',
  successBorder: '#C6DECF',
  warningBg: '#FBF4E8',
  warningBorder: '#E8D5B2',
  dangerBg: '#FAEEEE',
  dangerBorder: '#E7C7C7',
  infoBg: '#EFF3F7',
  infoBorder: '#D1DBE5',
} as const;

/** Shared geometry; table size variants and user density remain independent. */
export const TECH_WHITE_GEOMETRY = {
  panelRadius: 12,
  controlRadius: 8,
  controlHeight: 34,
  panelPadding: 20,
} as const;

export const TECH_WHITE_TYPOGRAPHY = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif",
  pageTitle: 22,
  sectionTitle: 16,
  body: 14,
  compact: 13,
  auxiliary: 12,
  lineHeight: 1.6,
  actionIcon: 16,
} as const;

export const SHELL_COLOR_VARIABLES: Record<string, string> = {
  '--mf-font-family': TECH_WHITE_TYPOGRAPHY.fontFamily,
  '--mf-font-title': `${TECH_WHITE_TYPOGRAPHY.pageTitle}px`,
  '--mf-font-section': `${TECH_WHITE_TYPOGRAPHY.sectionTitle}px`,
  '--mf-font-body': `${TECH_WHITE_TYPOGRAPHY.body}px`,
  '--mf-font-compact': `${TECH_WHITE_TYPOGRAPHY.compact}px`,
  '--mf-font-auxiliary': `${TECH_WHITE_TYPOGRAPHY.auxiliary}px`,
  '--mf-icon-action': `${TECH_WHITE_TYPOGRAPHY.actionIcon}px`,
  '--mf-panel-radius': `${TECH_WHITE_GEOMETRY.panelRadius}px`,
  '--mf-control-radius': `${TECH_WHITE_GEOMETRY.controlRadius}px`,
  '--mf-bg': TECH_WHITE_PALETTE.canvas,
  '--mf-panel': TECH_WHITE_PALETTE.surface,
  '--mf-panel-soft': TECH_WHITE_PALETTE.rail,
  '--mf-sidebar': TECH_WHITE_PALETTE.menu,
  '--mf-rail': TECH_WHITE_PALETTE.rail,
  '--mf-hover': TECH_WHITE_PALETTE.hover,
  '--mf-selected': TECH_WHITE_PALETTE.selected,
  '--mf-border': TECH_WHITE_PALETTE.border,
  '--mf-border-strong': TECH_WHITE_PALETTE.borderStrong,
  '--mf-text': TECH_WHITE_PALETTE.text,
  '--mf-muted': TECH_WHITE_PALETTE.muted,
  '--mf-faint': TECH_WHITE_PALETTE.faint,
  '--mf-icon': TECH_WHITE_PALETTE.icon,
  '--mf-primary': TECH_WHITE_PALETTE.primary,
  '--mf-accent': TECH_WHITE_PALETTE.primary,
  '--mf-text-secondary': TECH_WHITE_PALETTE.muted,
  '--mf-primary-strong': TECH_WHITE_PALETTE.primaryStrong,
  '--mf-success': TECH_WHITE_PALETTE.success,
  '--mf-warning': TECH_WHITE_PALETTE.warning,
  '--mf-danger': TECH_WHITE_PALETTE.danger,
  '--mf-success-bg': TECH_WHITE_PALETTE.successBg,
  '--mf-success-border': TECH_WHITE_PALETTE.successBorder,
  '--mf-warning-bg': TECH_WHITE_PALETTE.warningBg,
  '--mf-warning-border': TECH_WHITE_PALETTE.warningBorder,
  '--mf-danger-bg': TECH_WHITE_PALETTE.dangerBg,
  '--mf-danger-border': TECH_WHITE_PALETTE.dangerBorder,
  '--mf-info-bg': TECH_WHITE_PALETTE.infoBg,
  '--mf-info-border': TECH_WHITE_PALETTE.infoBorder,
};

export const THEME_SWATCHES: Array<{
  key: string;
  label: string;
  color: string;
  usage: string;
  group: 'neutral' | 'brand' | 'status';
}> = [
  { key: 'surface', label: '纯白', color: TECH_WHITE_PALETTE.surface, usage: '内容面板与顶部栏', group: 'neutral' },
  { key: 'canvas', label: '雾白', color: TECH_WHITE_PALETTE.canvas, usage: '工作区背景', group: 'neutral' },
  { key: 'menu', label: '浅灰白', color: TECH_WHITE_PALETTE.menu, usage: '菜单栏背景', group: 'neutral' },
  { key: 'rail', label: '云灰', color: TECH_WHITE_PALETTE.rail, usage: '应用栏背景', group: 'neutral' },
  { key: 'hover', label: '柔灰', color: TECH_WHITE_PALETTE.hover, usage: '悬停反馈', group: 'neutral' },
  { key: 'selected', label: '银灰', color: TECH_WHITE_PALETTE.selected, usage: '导航选中背景', group: 'neutral' },
  { key: 'border', label: '边界灰', color: TECH_WHITE_PALETTE.border, usage: '分隔线与边框', group: 'neutral' },
  { key: 'icon', label: '图标灰', color: TECH_WHITE_PALETTE.icon, usage: '未选中的应用图标', group: 'neutral' },
  { key: 'muted', label: '石灰', color: TECH_WHITE_PALETTE.muted, usage: '辅助文字', group: 'neutral' },
  { key: 'text', label: '墨黑', color: TECH_WHITE_PALETTE.text, usage: '正文与选中的应用图标', group: 'neutral' },
  { key: 'primary', label: '蓝灰', color: TECH_WHITE_PALETTE.primary, usage: '主要操作与链接', group: 'brand' },
  { key: 'primaryStrong', label: '深蓝灰', color: TECH_WHITE_PALETTE.primaryStrong, usage: '强调与 AI 助手入口', group: 'brand' },
  { key: 'success', label: '松绿', color: TECH_WHITE_PALETTE.success, usage: '成功与正常状态', group: 'status' },
  { key: 'warning', label: '琥珀', color: TECH_WHITE_PALETTE.warning, usage: '待关注与警告', group: 'status' },
  { key: 'danger', label: '砖红', color: TECH_WHITE_PALETTE.danger, usage: '错误与删除操作', group: 'status' },
];
