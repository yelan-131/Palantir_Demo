/** Theme cards: each user picks one in workspace preferences. Kept free of imports so tests can load it directly. */
export type ThemeCardId = 'graphite' | 'porcelain' | 'pine' | 'mist' | 'control-room';

export interface ThemeCardPalette {
  canvas: string; surface: string; sunken: string; header: string;
  rail: string; railIcon: string; railIconActive: string; railActive: string; railHover: string;
  side: string; sideText: string; sideMuted: string; sideHover: string; sideActive: string; sideActiveText: string; sideBorder: string;
  border: string; borderSoft: string; borderStrong: string;
  text: string; text2: string; muted: string; disabled: string;
  accent: string; accentHover: string; accentActive: string; accentSoft: string; accentText: string;
  focus: string; indicator: string; brand: string; brandText: string;
  hover: string; selected: string; selectedSoft: string;
  success: string; successBg: string; successBorder: string;
  warning: string; warningBg: string; warningBorder: string;
  danger: string; dangerBg: string; dangerBorder: string;
  info: string; infoBg: string; infoBorder: string;
  neutral: string; neutralBg: string;
  shadowPopover: string; shadowModal: string;
}

export interface ThemeCard {
  id: ThemeCardId;
  name: string;
  tag?: string;
  description: string;
  dark: boolean;
  /** Unavailable cards stay visible in preferences but cannot be selected yet. */
  available: boolean;
  palette: ThemeCardPalette;
}

const lightShadows = (rgb: string) => ({
  shadowPopover: `0 1px 2px rgba(${rgb}, .05), 0 8px 24px -8px rgba(${rgb}, .16)`,
  shadowModal: `0 2px 6px rgba(${rgb}, .06), 0 24px 64px -16px rgba(${rgb}, .30)`,
});

export const THEME_CARDS: ThemeCard[] = [
  {
    id: 'graphite', name: '石墨 · 信号橙', description: '深色导航框住浅色工作区，橙色只用于主要操作与选中。', dark: false, available: true,
    palette: {
      canvas: '#F3F2EF', surface: '#FFFFFF', sunken: '#F3F2EF', header: '#FFFFFF',
      rail: '#15171B', railIcon: '#8B9098', railIconActive: '#FFFFFF', railActive: '#2A2D33', railHover: '#22252A',
      side: '#1D2025', sideText: '#D5D8DD', sideMuted: '#959BA4', sideHover: '#262A30', sideActive: '#2C3037', sideActiveText: '#FFFFFF', sideBorder: '#2A2D33',
      border: '#E6E3DE', borderSoft: '#EFEDE9', borderStrong: '#CFCAC2',
      text: '#1A1C20', text2: '#3F4248', muted: '#64686F', disabled: '#B2B0AB',
      accent: '#C9420F', accentHover: '#D84E19', accentActive: '#A9370B', accentSoft: '#FCEDE6', accentText: '#FFFFFF',
      focus: '#C9420F', indicator: '#E5531A', brand: '#E5531A', brandText: '#FFFFFF',
      hover: '#F5F3F0', selected: '#FCEDE6', selectedSoft: '#FEF6F2',
      success: '#1C704C', successBg: '#E6F4EC', successBorder: '#BFE0CC',
      warning: '#8F5400', warningBg: '#FFF2DE', warningBorder: '#F0D7A8',
      danger: '#B8312A', dangerBg: '#FBEAE8', dangerBorder: '#F2C4BF',
      info: '#285EC2', infoBg: '#EAF0FC', infoBorder: '#C9D8F5',
      neutral: '#62666D', neutralBg: '#F0EFEC',
      ...lightShadows('26, 28, 32'),
    },
  },
  {
    id: 'porcelain', name: '瓷白 · 钴蓝', description: '全浅色，钴蓝强调，明亮精致。', dark: false, available: true,
    palette: {
      canvas: '#F4F5F9', surface: '#FFFFFF', sunken: '#F4F5F9', header: '#FFFFFF',
      rail: '#EEF0F6', railIcon: '#6B7286', railIconActive: '#2440E6', railActive: '#DDE3FC', railHover: '#E4E7F0',
      side: '#FBFBFD', sideText: '#262B3A', sideMuted: '#62697F', sideHover: '#EEF0F6', sideActive: '#2440E6', sideActiveText: '#FFFFFF', sideBorder: '#E7E9F0',
      border: '#E5E8F0', borderSoft: '#EFF1F6', borderStrong: '#C9CEDB',
      text: '#161A26', text2: '#3A4052', muted: '#62697F', disabled: '#ADB2C0',
      accent: '#2440E6', accentHover: '#3651F0', accentActive: '#1B33C2', accentSoft: '#ECEFFE', accentText: '#FFFFFF',
      focus: '#2440E6', indicator: '#2440E6', brand: '#2440E6', brandText: '#FFFFFF',
      hover: '#F1F3F8', selected: '#ECEFFE', selectedSoft: '#F5F7FF',
      success: '#11744A', successBg: '#E3F5EC', successBorder: '#B9E3CD',
      warning: '#8F5400', warningBg: '#FFF2DE', warningBorder: '#F0D7A8',
      danger: '#C02D27', dangerBg: '#FDECEA', dangerBorder: '#F6C6C2',
      info: '#2440E6', infoBg: '#ECEFFE', infoBorder: '#C9D2FB',
      neutral: '#62697F', neutralBg: '#F0F1F5',
      ...lightShadows('22, 26, 38'),
    },
  },
  {
    id: 'pine', name: '松林 · 黄铜', description: '深松绿应用栏与米色导航，黄铜色只做刻线与品牌。', dark: false, available: true,
    palette: {
      canvas: '#F6F4EE', surface: '#FFFEFB', sunken: '#F2EFE7', header: '#FFFEFB',
      rail: '#0E2621', railIcon: '#8DAFA3', railIconActive: '#F1E3C2', railActive: '#1C3D35', railHover: '#163330',
      side: '#EDEAE1', sideText: '#23302B', sideMuted: '#58625C', sideHover: '#E3DFD3', sideActive: '#DDD5C1', sideActiveText: '#17241F', sideBorder: '#DCD7CA',
      border: '#E5E1D6', borderSoft: '#EFECE4', borderStrong: '#CEC7B6',
      text: '#1B2420', text2: '#3C4741', muted: '#5D6761', disabled: '#B3B0A6',
      accent: '#1D5444', accentHover: '#256652', accentActive: '#154234', accentSoft: '#E6EFEA', accentText: '#FFFFFF',
      focus: '#1D5444', indicator: '#B8862C', brand: '#B8862C', brandText: '#0E2621',
      hover: '#F3F0E8', selected: '#E6EFEA', selectedSoft: '#F1F6F3',
      success: '#2B7046', successBg: '#E5F1E8', successBorder: '#C2DCC9',
      warning: '#7F560D', warningBg: '#F6EBD3', warningBorder: '#E6D2A6',
      danger: '#A33427', dangerBg: '#F8E7E3', dangerBorder: '#EBC6BE',
      info: '#285F82', infoBg: '#E5EEF4', infoBorder: '#C3D6E3',
      neutral: '#665F52', neutralBg: '#EFECE4',
      ...lightShadows('27, 36, 32'),
    },
  },
  {
    id: 'mist', name: '浅雾蓝', tag: '原有', description: '原有的灰蓝体系，保留给习惯旧界面的用户。', dark: false, available: true,
    palette: {
      canvas: '#F5F6F7', surface: '#FFFFFF', sunken: '#F1F2F3', header: '#FFFFFF',
      rail: '#F1F2F3', railIcon: '#64778C', railIconActive: '#252B32', railActive: '#DFE2E5', railHover: '#E6E8EA',
      side: '#FFFFFF', sideText: '#252B32', sideMuted: '#5D6772', sideHover: '#F1F4F6', sideActive: '#E8EEF3', sideActiveText: '#3E5B80', sideBorder: '#DFE2E5',
      border: '#DFE2E5', borderSoft: '#ECEEF0', borderStrong: '#BBC3CB',
      text: '#252B32', text2: '#3F4851', muted: '#5D6772', disabled: '#A9B0B8',
      accent: '#476791', accentHover: '#56769F', accentActive: '#344D6B', accentSoft: '#E8EEF3', accentText: '#FFFFFF',
      focus: '#476791', indicator: '#476791', brand: '#476791', brandText: '#FFFFFF',
      hover: '#F1F4F6', selected: '#E8EEF3', selectedSoft: '#F3F6F9',
      success: '#2B7454', successBg: '#EDF6F0', successBorder: '#C6DECF',
      warning: '#8A5C18', warningBg: '#FBF4E8', warningBorder: '#E8D5B2',
      danger: '#A43D3D', dangerBg: '#FAEEEE', dangerBorder: '#E7C7C7',
      info: '#41608A', infoBg: '#F0F5FF', infoBorder: '#DAE4F5',
      neutral: '#5D6772', neutralBg: '#F1F2F3',
      ...lightShadows('31, 44, 52'),
    },
  },
  {
    id: 'control-room', name: '控制室', tag: '暗色', description: '全暗界面，适合大屏与夜班。全站颜色清理完成后开放。', dark: true, available: false,
    palette: {
      canvas: '#0B0E12', surface: '#12161C', sunken: '#0E1217', header: '#0F1217',
      rail: '#08090C', railIcon: '#7A8491', railIconActive: '#3DDC97', railActive: '#151A20', railHover: '#11151A',
      side: '#0F1217', sideText: '#C9D0D8', sideMuted: '#7E8896', sideHover: '#171C23', sideActive: '#1A2129', sideActiveText: '#FFFFFF', sideBorder: '#1C222A',
      border: '#232A33', borderSoft: '#1A2028', borderStrong: '#36404C',
      text: '#E7EBF0', text2: '#BCC4CE', muted: '#8590A0', disabled: '#4E5763',
      accent: '#3DDC97', accentHover: '#5BE8AA', accentActive: '#2FC283', accentSoft: '#12271F', accentText: '#05140D',
      focus: '#3DDC97', indicator: '#3DDC97', brand: '#3DDC97', brandText: '#05140D',
      hover: '#171C23', selected: '#12271F', selectedSoft: '#0F1F19',
      success: '#3DDC97', successBg: '#12271F', successBorder: '#1F4A37',
      warning: '#FFB547', warningBg: '#2E2312', warningBorder: '#5A4420',
      danger: '#FF6B5E', dangerBg: '#2E1716', dangerBorder: '#5C2A27',
      info: '#6AA8FF', infoBg: '#142236', infoBorder: '#24406A',
      neutral: '#8590A0', neutralBg: '#1A2028',
      shadowPopover: '0 0 0 1px #232A33, 0 12px 32px -8px rgba(0, 0, 0, .6)',
      shadowModal: '0 0 0 1px #2A323C, 0 24px 64px -12px rgba(0, 0, 0, .75)',
    },
  },
];

export const DEFAULT_THEME_CARD: ThemeCardId = 'graphite';

export type TypeRole = 'display' | 'title' | 'heading' | 'section' | 'body' | 'control' | 'caption';

/**
 * Type scale shared by every card. Line heights sit on a 2px grid. Microsoft YaHei ships only
 * Regular and Bold, so on Windows 500 renders like 400: hierarchy must come from size and color.
 */
export const UI_TYPE = {
  family: {
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
    numeric: "Bahnschrift, 'DIN Alternate', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",
    mono: "'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, 'Microsoft YaHei UI', monospace",
  },
  role: {
    display: { size: 34, line: 36, weight: 600, tracking: '-0.02em' },
    title: { size: 26, line: 32, weight: 600, tracking: '-0.01em' },
    heading: { size: 20, line: 28, weight: 600, tracking: '0' },
    section: { size: 16, line: 24, weight: 600, tracking: '0' },
    body: { size: 14, line: 22, weight: 400, tracking: '0' },
    control: { size: 13, line: 20, weight: 400, tracking: '0' },
    caption: { size: 12, line: 18, weight: 400, tracking: '0' },
  } satisfies Record<TypeRole, { size: number; line: number; weight: 400 | 500 | 600; tracking: string }>,
  weight: { regular: 400, medium: 500, strong: 600 },
  minSize: 12,
} as const;

/** Shared geometry for every card. `font` keeps the sizes existing pages already consume. */
export const UI_SCALE = {
  radius: { tag: 4, control: 6, panel: 10, overlay: 14 },
  control: { small: 28, middle: 32, large: 40 },
  // Page titles stay at 22 until pages adopt the `title` role, so existing layouts do not shift.
  font: { title: 22, section: 16, body: 14, compact: 13, auxiliary: 12 },
  fontFamily: UI_TYPE.family.sans,
  numericFontFamily: UI_TYPE.family.numeric,
  space: { small: 8, medium: 12, section: 16, panel: 24 },
} as const;

/** Stored value `tech-white` predates theme cards and was never a user choice, so it resolves to the default. */
export function resolveThemeCardId(value: unknown): ThemeCardId {
  const card = THEME_CARDS.find(item => item.id === value);
  return card?.available ? card.id : DEFAULT_THEME_CARD;
}

export function getThemeCard(value: unknown): ThemeCard {
  const id = resolveThemeCardId(value);
  return THEME_CARDS.find(card => card.id === id)!;
}

/** Variables for both the legacy `--mf-*` / `--canon-*` names and the card-only `--ui-*` names. */
export function themeCardCssVariables(card: ThemeCard): Record<string, string> {
  const p = card.palette;
  const r = UI_SCALE.radius;
  const f = UI_SCALE.font;
  return {
    '--mf-space-small': `${UI_SCALE.space.small}px`,
    '--mf-space-medium': `${UI_SCALE.space.medium}px`,
    '--mf-space-section': `${UI_SCALE.space.section}px`,
    '--mf-space-panel': `${UI_SCALE.space.panel}px`,
    '--mf-font-family': UI_SCALE.fontFamily,
    '--mf-font-title': `${f.title}px`,
    '--mf-font-section': `${f.section}px`,
    '--mf-font-body': `${f.body}px`,
    '--mf-font-compact': `${f.compact}px`,
    '--mf-font-auxiliary': `${f.auxiliary}px`,
    '--mf-icon-action': '16px',
    '--mf-panel-radius': `${r.panel}px`,
    '--mf-control-radius': `${r.control}px`,
    '--mf-bg': p.canvas,
    '--mf-panel': p.surface,
    '--mf-surface': p.surface,
    '--mf-panel-soft': p.sunken,
    '--mf-sidebar': p.sunken,
    '--mf-rail': p.sunken,
    '--mf-hover': p.hover,
    '--mf-selected': p.selected,
    '--mf-border': p.border,
    '--mf-border-strong': p.borderStrong,
    '--mf-text': p.text,
    '--mf-muted': p.muted,
    '--mf-faint': p.muted,
    '--mf-icon': p.muted,
    '--mf-primary': p.accent,
    '--mf-accent': p.accent,
    '--mf-text-secondary': p.muted,
    '--mf-primary-strong': p.accentActive,
    '--mf-feature-bg': p.surface,
    '--mf-focus': p.focus,
    '--mf-icon-bg': p.accentSoft,
    '--mf-success': p.success,
    '--mf-warning': p.warning,
    '--mf-danger': p.danger,
    '--mf-success-bg': p.successBg,
    '--mf-success-border': p.successBorder,
    '--mf-warning-bg': p.warningBg,
    '--mf-warning-border': p.warningBorder,
    '--mf-danger-bg': p.dangerBg,
    '--mf-danger-border': p.dangerBorder,
    '--mf-info': p.info,
    '--mf-info-bg': p.infoBg,
    '--mf-info-border': p.infoBorder,
    '--mf-neutral': p.neutral,
    '--mf-neutral-bg': p.neutralBg,
    '--mf-shadow': p.shadowPopover,
    '--canon-canvas': p.canvas,
    '--canon-surface': p.surface,
    '--canon-rail': p.sunken,
    '--canon-fill': p.sunken,
    '--canon-hover': p.hover,
    '--canon-border': p.border,
    '--canon-border-soft': p.borderSoft,
    '--canon-border-strong': p.borderStrong,
    '--canon-text': p.text,
    '--canon-muted': p.muted,
    '--canon-primary': p.accent,
    '--canon-primary-hover': p.accentHover,
    '--canon-selected': p.selected,
    '--canon-selected-soft': p.selectedSoft,
    '--canon-focus': p.focus,
    '--canon-success': p.success,
    '--canon-success-bg': p.successBg,
    '--canon-success-dot': p.success,
    '--canon-warning': p.warning,
    '--canon-warning-bg': p.warningBg,
    '--canon-warning-dot': p.warning,
    '--canon-danger': p.danger,
    '--canon-danger-bg': p.dangerBg,
    '--canon-neutral-dot': p.neutral,
    '--canon-info': p.info,
    '--canon-info-bg': p.infoBg,
    '--canon-font-caption': `${f.auxiliary}px`,
    '--canon-font-body': `${f.body}px`,
    '--canon-font-section': `${f.section}px`,
    '--canon-font-title': `${f.title}px`,
    '--canon-radius-control': `${r.control}px`,
    '--canon-radius-panel': `${r.panel}px`,
    '--canon-row-height': '44px',
    '--ui-rail-bg': p.rail,
    '--ui-rail-icon': p.railIcon,
    '--ui-rail-icon-active': p.railIconActive,
    '--ui-rail-active': p.railActive,
    '--ui-rail-hover': p.railHover,
    '--ui-side-bg': p.side,
    '--ui-side-text': p.sideText,
    '--ui-side-muted': p.sideMuted,
    '--ui-side-hover': p.sideHover,
    '--ui-side-active': p.sideActive,
    '--ui-side-active-text': p.sideActiveText,
    '--ui-side-border': p.sideBorder,
    '--ui-header-bg': p.header,
    '--ui-indicator': p.indicator,
    '--ui-brand': p.brand,
    '--ui-brand-text': p.brandText,
    '--ui-sunken': p.sunken,
    '--ui-text-2': p.text2,
    '--ui-disabled': p.disabled,
    '--ui-accent-soft': p.accentSoft,
    '--ui-accent-text': p.accentText,
    '--ui-accent-active': p.accentActive,
    '--ui-shadow-popover': p.shadowPopover,
    '--ui-shadow-modal': p.shadowModal,
    '--ui-radius-tag': `${r.tag}px`,
    '--ui-radius-overlay': `${r.overlay}px`,
    '--ui-font-sans': UI_TYPE.family.sans,
    '--ui-font-numeric': UI_TYPE.family.numeric,
    '--ui-font-mono': UI_TYPE.family.mono,
    ...Object.fromEntries(Object.entries(UI_TYPE.role).flatMap(([role, t]) => [
      [`--ui-text-${role}-size`, `${t.size}px`],
      [`--ui-text-${role}-line`, `${t.line}px`],
      [`--ui-text-${role}-weight`, String(t.weight)],
      [`--ui-text-${role}-tracking`, t.tracking],
    ])),
  };
}

/** WCAG relative-luminance contrast ratio between two `#RRGGBB` colors. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
