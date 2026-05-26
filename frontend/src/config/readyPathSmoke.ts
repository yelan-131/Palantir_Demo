import { BREADCRUMB_MAP, BUSINESS_MENUS } from './menus';

type ReadyRoute = '/' | '/account-center' | '/system-admin' | '/workflow' | '/reports';

const readyPathRoutes = ['/', '/account-center', '/system-admin', '/workflow', '/reports'] as const satisfies readonly ReadyRoute[];

const requiredBusinessRoutes = ['/', '/dashboard', '/maintenance', '/quality', '/supply-chain'] as const;

export const READY_PATH_ROUTE_SMOKE = {
  routes: readyPathRoutes,
  businessRoutes: requiredBusinessRoutes,
  breadcrumbs: readyPathRoutes.map((route) => BREADCRUMB_MAP[route]),
  businessMenuKeys: BUSINESS_MENUS.map((item) => item.key),
};

readyPathRoutes.forEach((route) => {
  if (!BREADCRUMB_MAP[route]) {
    throw new Error(`Missing breadcrumb for ready path route: ${route}`);
  }
});

requiredBusinessRoutes.forEach((route) => {
  if (!BUSINESS_MENUS.some((item) => item.key === route)) {
    throw new Error(`Missing business menu route: ${route}`);
  }
});
