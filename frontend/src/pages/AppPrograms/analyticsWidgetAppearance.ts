import type {RuntimeAnalyticsWidget} from './analyticsTypes';

export const widgetPalettes = {
  manufacturing: ['#2c6e84', '#24986b', '#718d38'],
  business: ['#3867b0', '#b27d32', '#7e62a3'],
  warning: ['#cb494b', '#cc8a23', '#6d8d35'],
  mono: ['#2c6e84', '#628fa1', '#99b4be'],
};
export type AnalyticsWidgetAppearance = {
  subtitle?: string;
  palette?: keyof typeof widgetPalettes;
  height?: number;
  radius?: number;
  showLegend?: boolean;
  showLabels?: boolean;
  smooth?: boolean;
};

// Old snapshots inherit the page theme; malformed optional values cannot break the canvas.
export function widgetAppearance(widget: RuntimeAnalyticsWidget, page: Record<string, unknown> = {}) {
  const raw = widget.appearance && typeof widget.appearance === 'object' ? widget.appearance : {};
  const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max,Math.max(min,value)) : fallback;
  const palette = Object.prototype.hasOwnProperty.call(widgetPalettes, raw.palette || '') ? raw.palette! : Object.prototype.hasOwnProperty.call(widgetPalettes, String(page.chartPalette)) ? String(page.chartPalette) as keyof typeof widgetPalettes : 'manufacturing';
  return {palette, colors:widgetPalettes[palette], height:bounded(raw.height,280,200,640),
    radius:bounded(raw.radius,bounded(page.cardRadius,8,0,24),0,24),
    subtitle:typeof raw.subtitle === 'string' ? raw.subtitle : '',
    showLegend:raw.showLegend !== false, showLabels:typeof raw.showLabels === 'boolean' ? raw.showLabels : widget.type === 'pie', smooth:raw.smooth === true};
}
