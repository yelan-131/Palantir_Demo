import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

const PageTitleContext = createContext<{
  title: string;
  setTitle: (title?: string) => void;
  ownsHeading: boolean;
  setOwnsHeading: (owns: boolean) => void;
}>({ title: '', setTitle: () => {}, ownsHeading: false, setOwnsHeading: () => {} });

export function ShellPageTitleProvider({ fallback, children }: { fallback: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const [page, setPage] = useState<{ pathname: string; title?: string }>();
  const [headingPath, setHeadingPath] = useState<string>();
  const setTitle = useCallback((title?: string) => setPage({ pathname, title }), [pathname]);
  const setOwnsHeading = useCallback((owns: boolean) => setHeadingPath(owns ? pathname : undefined), [pathname]);
  const title = page?.pathname === pathname && page.title ? page.title : fallback;
  return <PageTitleContext.Provider value={{ title, setTitle, ownsHeading: headingPath === pathname, setOwnsHeading }}>{children}</PageTitleContext.Provider>;
}

// Configured forms publish their actual name to the shared heading instead of adding a second heading.
export function useShellPageTitle(title?: string, enabled = true) {
  const { setTitle } = useContext(PageTitleContext);
  useEffect(() => {
    if (!enabled) return;
    setTitle(title);
    return () => setTitle(undefined);
  }, [title, setTitle, enabled]);
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
  const { title, ownsHeading } = useContext(PageTitleContext);
  const showSection = Boolean(section) && section !== title;
  const Current = ownsHeading ? 'span' : 'h1';
  return <nav className="shell-page-title" aria-label="当前位置">
    {showSection && <>
      <span className="shell-page-crumb" title={section}>{section}</span>
      <span className="shell-page-crumb-separator" aria-hidden="true">/</span>
    </>}
    <Current className="shell-page-current" title={title} aria-current="page">{title}</Current>
  </nav>;
}
