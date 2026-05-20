export type SavedAssemblyMenuNode = {
  key: string;
  label: string;
  formId?: string;
  visible?: boolean;
  defaultEntry?: boolean;
  children?: SavedAssemblyMenuNode[];
};

export type RuntimeDynamicMenu = {
  id: number;
  parent_id: number | null;
  title: string;
  route_path: string;
  icon?: string;
  is_visible: boolean;
  children?: RuntimeDynamicMenu[];
};

export const APP_ASSEMBLY_MENUS_STORAGE_KEY = 'mf_app_assembly_menus';
export const APP_ASSEMBLY_MENU_EVENT = 'mf-app-assembly-menus-updated';

const formRouteMap: Record<string, { route: string; icon: string }> = {
  'production-overview': { route: '/program/production-overview', icon: 'DashboardOutlined' },
  'oee-trend-report': { route: '/program/oee-trend-report', icon: 'DashboardOutlined' },
  'line-status': { route: '/program/line-status', icon: 'DashboardOutlined' },
  'line-load-analysis': { route: '/program/line-load-analysis', icon: 'DashboardOutlined' },
  'production-plan-entry': { route: '/program/production-plan-entry', icon: 'AppstoreOutlined' },
  'device-health': { route: '/program/device-health', icon: 'ToolOutlined' },
  'fault-prediction': { route: '/program/fault-prediction', icon: 'ToolOutlined' },
  'maintenance-order': { route: '/program/maintenance-order', icon: 'AppstoreOutlined' },
  'alert-center': { route: '/program/alert-center', icon: 'SafetyCertificateOutlined' },
  'quality-overview': { route: '/program/quality-overview', icon: 'SafetyCertificateOutlined' },
  'inspection-batch': { route: '/program/inspection-batch', icon: 'SafetyCertificateOutlined' },
  'defect-analysis': { route: '/program/defect-analysis', icon: 'SafetyCertificateOutlined' },
  'quality-event': { route: '/program/quality-event', icon: 'SafetyCertificateOutlined' },
  'supplier-risk': { route: '/program/supplier-risk', icon: 'ShopOutlined' },
  'supply-overview': { route: '/program/supply-overview', icon: 'ShopOutlined' },
  'material-impact': { route: '/program/material-impact', icon: 'ShopOutlined' },
  'risk-review': { route: '/program/risk-review', icon: 'SafetyCertificateOutlined' },
};

const menuKeyRouteMap: Record<string, { route: string; icon: string }> = {
  'prod-oee-report': { route: '/program/oee-trend-report', icon: 'DashboardOutlined' },
  'prod-line-report': { route: '/program/line-load-analysis', icon: 'DashboardOutlined' },
  'prod-plan-entry': { route: '/program/production-plan-entry', icon: 'AppstoreOutlined' },
};

function numericId(appId: number, key: string): number {
  let hash = appId * 1000;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 900000;
  }
  return hash + 10000;
}

export function loadAssemblyMenus(): Record<number, SavedAssemblyMenuNode[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(APP_ASSEMBLY_MENUS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveAssemblyMenus(next: Record<number, SavedAssemblyMenuNode[]>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(APP_ASSEMBLY_MENUS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(APP_ASSEMBLY_MENU_EVENT));
}

export function savedAssemblyMenusToDynamicMenus(
  appId: number,
  nodes: SavedAssemblyMenuNode[],
): RuntimeDynamicMenu[] {
  return nodes
    .filter((node) => node.visible !== false)
    .map((node) => {
      const routeInfo = menuKeyRouteMap[node.key] || (node.formId ? formRouteMap[node.formId] : undefined);
      const children = node.children?.length
        ? savedAssemblyMenusToDynamicMenus(appId, node.children)
        : undefined;

      return {
        id: numericId(appId, node.key),
        parent_id: null,
        title: node.label,
        route_path: routeInfo?.route || (children?.length ? '' : `/dynamic/${node.formId || node.key}`),
        icon: routeInfo?.icon || (children?.length ? 'AppstoreOutlined' : 'DashboardOutlined'),
        is_visible: node.visible !== false,
        children,
      };
    });
}
