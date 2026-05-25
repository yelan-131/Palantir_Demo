export type SavedAssemblyMenuNode = {
  key: string;
  label: string;
  formId?: string;
  routePath?: string;
  visible?: boolean;
  defaultEntry?: boolean;
  permissionMode?: 'inherit' | 'custom';
  roleIds?: number[];
  permissionActions?: string[];
  permissionRules?: Array<{
    subjectType: 'app_roles' | 'roles' | 'users';
    roleIds?: number[];
    userKeys?: string[];
    actions: string[];
    effect: 'allow' | 'deny';
  }>;
  dataScope?: string;
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
  'device-health-dashboard': { route: '/program/device-health-dashboard', icon: 'ToolOutlined' },
  'fault-prediction': { route: '/program/fault-prediction', icon: 'ToolOutlined' },
  'failure-trend-analysis': { route: '/program/failure-trend-analysis', icon: 'ToolOutlined' },
  'maintenance-order': { route: '/program/maintenance-order', icon: 'AppstoreOutlined' },
  'alert-center': { route: '/program/alert-center', icon: 'SafetyCertificateOutlined' },
  'quality-overview': { route: '/program/quality-overview', icon: 'SafetyCertificateOutlined' },
  'inspection-batch': { route: '/program/inspection-batch', icon: 'SafetyCertificateOutlined' },
  'defect-analysis': { route: '/program/defect-analysis', icon: 'SafetyCertificateOutlined' },
  'defect-analysis-report': { route: '/program/defect-analysis-report', icon: 'SafetyCertificateOutlined' },
  'process-capability-dashboard': { route: '/program/process-capability-dashboard', icon: 'SafetyCertificateOutlined' },
  'quality-event': { route: '/program/quality-event', icon: 'SafetyCertificateOutlined' },
  'supplier-risk': { route: '/program/supplier-risk', icon: 'ShopOutlined' },
  'supply-overview': { route: '/program/supply-overview', icon: 'ShopOutlined' },
  'material-impact': { route: '/program/material-impact', icon: 'ShopOutlined' },
  'material-impact-report': { route: '/program/material-impact-report', icon: 'ShopOutlined' },
  'supply-risk-dashboard': { route: '/program/supply-risk-dashboard', icon: 'ShopOutlined' },
  'risk-review': { route: '/program/risk-review', icon: 'SafetyCertificateOutlined' },
};

const menuKeyRouteMap: Record<string, { route: string; icon: string }> = {
  'prod-oee-report': { route: '/program/oee-trend-report', icon: 'DashboardOutlined' },
  'prod-line-report': { route: '/program/line-load-analysis', icon: 'DashboardOutlined' },
  'prod-plan-entry': { route: '/program/production-plan-entry', icon: 'AppstoreOutlined' },
  'pm-failure-trend': { route: '/program/failure-trend-analysis', icon: 'ToolOutlined' },
  'pm-health-dashboard': { route: '/program/device-health-dashboard', icon: 'ToolOutlined' },
  'quality-defect-report': { route: '/program/defect-analysis-report', icon: 'SafetyCertificateOutlined' },
  'quality-capability-report': { route: '/program/process-capability-dashboard', icon: 'SafetyCertificateOutlined' },
  'supply-material-report': { route: '/program/material-impact-report', icon: 'ShopOutlined' },
  'supply-risk-dashboard': { route: '/program/supply-risk-dashboard', icon: 'ShopOutlined' },
};

function routeInfoForNode(node: SavedAssemblyMenuNode): { route: string; icon: string } | undefined {
  if (node.routePath) return { route: node.routePath, icon: 'AppstoreOutlined' };
  return menuKeyRouteMap[node.key] || (node.formId ? formRouteMap[node.formId] : undefined);
}

function findDefaultNodeRoute(nodes: SavedAssemblyMenuNode[]): string | undefined {
  for (const node of nodes) {
    if (node.visible === false) continue;
    const routeInfo = routeInfoForNode(node);
    if (node.defaultEntry && routeInfo?.route) {
      return routeInfo.route;
    }
    const childRoute = node.children?.length ? findDefaultNodeRoute(node.children) : undefined;
    if (childRoute) return childRoute;
  }
  return undefined;
}

function findFirstNodeRoute(nodes: SavedAssemblyMenuNode[]): string | undefined {
  for (const node of nodes) {
    if (node.visible === false) continue;
    const routeInfo = routeInfoForNode(node);
    if (routeInfo?.route) return routeInfo.route;
    const childRoute = node.children?.length ? findFirstNodeRoute(node.children) : undefined;
    if (childRoute) return childRoute;
  }
  return undefined;
}

export function getAssemblyMenuDefaultRoute(nodes: SavedAssemblyMenuNode[]): string | undefined {
  return findDefaultNodeRoute(nodes) || findFirstNodeRoute(nodes);
}

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
      const routeInfo = routeInfoForNode(node);
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
