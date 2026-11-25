import {
  BookOpen, ChartColumn, ChartLine, CircleCheck, ClipboardList, Clock, Database, Factory, FilePenLine, FileSearch,
  FlaskConical, Folder, Gauge, History, House, LayoutGrid, Network, Package, Power, ShieldCheck, Star, Store,
  TriangleAlert, Truck, Users, Workflow, Wrench,
  type LucideIcon, type LucideProps,
} from 'lucide-react';
import { ICON_STROKE, resolveAppIconName, type AppIconName, type IconSize } from './iconNames';

export { LEGACY_APP_ICONS, resolveAppIconName, type AppIconName, type IconSize } from './iconNames';

const APP_ICONS: Record<AppIconName, LucideIcon> = {
  'layout-grid': LayoutGrid, house: House, folder: Folder, 'file-pen-line': FilePenLine, clock: Clock, history: History,
  'chart-column': ChartColumn, 'chart-line': ChartLine, database: Database, wrench: Wrench, 'shield-check': ShieldCheck,
  store: Store, 'circle-check': CircleCheck, workflow: Workflow, 'book-open': BookOpen, 'triangle-alert': TriangleAlert,
  'flask-conical': FlaskConical, 'file-search': FileSearch, power: Power, network: Network, users: Users,
  factory: Factory, package: Package, truck: Truck, gauge: Gauge, 'clipboard-list': ClipboardList, star: Star,
};

export interface IconProps extends Omit<LucideProps, 'size' | 'ref'> {
  icon: LucideIcon;
  size?: IconSize;
}

/** Decorative by default; give the surrounding control an accessible name. */
export function Icon({ icon: Glyph, size = 16, strokeWidth, className, ...rest }: IconProps) {
  return <Glyph size={size} strokeWidth={strokeWidth ?? ICON_STROKE[size]} className={className ? `ui-icon ${className}` : 'ui-icon'} aria-hidden focusable="false" {...rest} />;
}

export function AppIcon({ name, ...rest }: Omit<IconProps, 'icon'> & { name?: string }) {
  return <Icon icon={APP_ICONS[resolveAppIconName(name)]} {...rest} />;
}
