import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

const PageTitleContext = createContext<{
  title: string;
  setTitle: (title?: string) => void;
}>({ title: '', setTitle: () => {} });

export function ShellPageTitleProvider({ fallback, children }: { fallback: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const [page, setPage] = useState<{ pathname: string; title?: string }>();
  const setTitle = useCallback((title?: string) => setPage({ pathname, title }), [pathname]);
  const title = page?.pathname === pathname && page.title ? page.title : fallback;
  return <PageTitleContext.Provider value={{ title, setTitle }}>{children}</PageTitleContext.Provider>;
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

export default function ShellPageTitle() {
  const { title } = useContext(PageTitleContext);
  return <h1 className="shell-page-title" title={title}>{title}</h1>;
}
