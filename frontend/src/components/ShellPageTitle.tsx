import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

export type PageCrumb = { label: string; to?: string };

const PageTitleContext = createContext<{
  title: string;
  trail?: PageCrumb[];
  setTitle: (title?: string, trail?: PageCrumb[]) => void;
  ownsHeading: boolean;
  setOwnsHeading: (owns: boolean) => void;
}>({ title: '', setTitle: () => {}, ownsHeading: false, setOwnsHeading: () => {} });

export function ShellPageTitleProvider({ fallback, children }: { fallback: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const [page, setPage] = useState<{ pathname: string; title?: string; trail?: PageCrumb[] }>();
  const [headingPath, setHeadingPath] = useState<string>();
  const setTitle = useCallback((title?: string, trail?: PageCrumb[]) => setPage({ pathname, title, trail }), [pathname]);
  const setOwnsHeading = useCallback((owns: boolean) => setHeadingPath(owns ? pathname : undefined), [pathname]);
  const currentPage = page?.pathname === pathname ? page : undefined;
  const title = currentPage?.title || fallback;
  return <PageTitleContext.Provider value={{ title, trail: currentPage?.trail, setTitle, ownsHeading: headingPath === pathname, setOwnsHeading }}>{children}</PageTitleContext.Provider>;
}

// Configured forms publish their actual name to the shared heading instead of adding a second heading.
export function useShellPageTitle(title?: string, enabled = true, trail?: PageCrumb[]) {
  const { setTitle } = useContext(PageTitleContext);
  useEffect(() => {
    if (!enabled) return;
    setTitle(title, trail);
    return () => setTitle(undefined);
  }, [title, setTitle, enabled, trail]);
}

/** A page that renders its own h1 demotes the breadcrumb's current item so the page keeps exactly one h1. */
export function useShellPageOwnsHeading(owns = true) {
  const { setOwnsHeading } = useContext(PageTitleContext);
  useEffect(() => {
    if (!owns) return;
    setOwnsHeading(true);
    return () => setOwnsHeading(false);
  }, [owns, setOwnsHeading]);
}

export default function ShellPageTitle({ section }: { section?: string }) {
  const { title, trail, ownsHeading } = useContext(PageTitleContext);
  const showSection = Boolean(section) && section !== title;
  const crumbs = trail ?? (showSection && section ? [{label: section}] : []);
  const Current = ownsHeading ? 'span' : 'h1';
  return <nav className="shell-page-title" aria-label="当前位置">
    {crumbs.map(({label, to}) => <span key={label} className="shell-page-crumb-item">
      {to ? <Link to={to} className="shell-page-crumb" title={label}>{label}</Link>
        : <span className="shell-page-crumb" title={label}>{label}</span>}
      <span className="shell-page-crumb-separator" aria-hidden="true">/</span>
    </span>)}
    <Current className="shell-page-current" title={title} aria-current="page">{title}</Current>
  </nav>;
}
