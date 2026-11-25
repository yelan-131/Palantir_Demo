export type IconSize = 12 | 14 | 16 | 20 | 24 | 32;

/** Smaller glyphs need relatively thicker strokes to keep the same visual weight. */
export const ICON_STROKE: Record<IconSize, number> = { 12: 2, 14: 1.85, 16: 1.75, 20: 1.6, 24: 1.5, 32: 1.3 };

export const APP_ICON_NAMES = [
  'layout-grid', 'house', 'folder', 'file-pen-line', 'clock', 'history', 'chart-column', 'chart-line', 'database',
  'wrench', 'shield-check', 'store', 'circle-check', 'workflow', 'book-open', 'triangle-alert', 'flask-conical',
  'file-search', 'power', 'network', 'users', 'factory', 'package', 'truck', 'gauge', 'clipboard-list', 'star',
] as const;
export type AppIconName = typeof APP_ICON_NAMES[number];

/**
 * Application and menu icons are stored by Ant Design name in the database, seeds and personal
 * overrides. They keep those names and only render through Lucide.
 */
export const LEGACY_APP_ICONS: Record<string, AppIconName> = {
  AppstoreOutlined: 'layout-grid',
  HomeOutlined: 'house',
  FolderOutlined: 'folder',
  FormOutlined: 'file-pen-line',
  ClockCircleOutlined: 'clock',
  HistoryOutlined: 'history',
  DashboardOutlined: 'chart-column',
  BarChartOutlined: 'chart-column',
  LineChartOutlined: 'chart-line',
  DatabaseOutlined: 'database',
  ToolOutlined: 'wrench',
  SafetyCertificateOutlined: 'shield-check',
  ShopOutlined: 'store',
  CheckOutlined: 'circle-check',
  CheckCircleOutlined: 'circle-check',
  ApartmentOutlined: 'workflow',
  BookOutlined: 'book-open',
  WarningOutlined: 'triangle-alert',
  ExperimentOutlined: 'flask-conical',
  FileSearchOutlined: 'file-search',
  PoweroffOutlined: 'power',
  ApiOutlined: 'network',
  TeamOutlined: 'users',
  StarOutlined: 'star',
};

export function resolveAppIconName(value?: string): AppIconName {
  if (!value) return 'layout-grid';
  if (Object.prototype.hasOwnProperty.call(LEGACY_APP_ICONS, value)) return LEGACY_APP_ICONS[value];
  return (APP_ICON_NAMES as readonly string[]).includes(value) ? value as AppIconName : 'layout-grid';
}
