import type { MenuProps } from 'antd';
import type { ReactNode } from 'react';

function applicationPageRoutes(items: MenuProps['items']): string[] {
  return (items || []).flatMap(item => {
    if (!item || ('disabled' in item && item.disabled)) return [];
    if ('children' in item && item.children?.length) return applicationPageRoutes(item.children);
    const route = 'key' in item ? item.key : undefined;
    return typeof route === 'string' && /^\/(?!\/)[^?#\\]+/.test(route) && !route.includes('\\') ? [route] : [];
  });
}

/** Show navigation as soon as the application has a reachable page. */
export function hasApplicationPage(items: MenuProps['items']): boolean {
  return applicationPageRoutes(items).length > 0;
}

export function resolveApplicationEntry(items: MenuProps['items'], configuredRoute: string): string | undefined {
  const routes = applicationPageRoutes(items);
  return routes.includes(configuredRoute) ? configuredRoute : routes[0];
}

/** Keep a stable home link above the currently selected application's pages. */
export function applicationNavigation(
  home: NonNullable<MenuProps['items']>[number],
  pages: MenuProps['items'],
): NonNullable<MenuProps['items']> {
  return pages?.length ? [home, { type: 'divider', key: 'workspace-app-divider' }, ...pages] : [home];
}

/** All shell groups use the same expandable hierarchy, including supplied menus. */
export function normalizeShellMenu(items: MenuProps['items'], groupIcon: ReactNode): NonNullable<MenuProps['items']> {
  return (items || []).map((item, index) => {
    if (!item || !('children' in item) || !item.children?.length) return item;
    const { type, ...parent } = item;
    return {
      ...parent,
      key: String(item.key ?? `menu-group-${index}`),
      icon: 'icon' in item && item.icon ? item.icon : groupIcon,
      children: normalizeShellMenu(item.children, groupIcon),
    };
  });
}

/** Return every ancestor so a deep link exposes its selected destination. */
export function shellMenuAncestors(items: MenuProps['items'], selectedKey: string): string[] | null {
  for (const item of items || []) {
    if (!item || !('key' in item)) continue;
    if (String(item.key) === selectedKey) return [];
    if ('children' in item) {
      const ancestors = shellMenuAncestors(item.children, selectedKey);
      if (ancestors) return [String(item.key), ...ancestors];
    }
  }
  return null;
}
