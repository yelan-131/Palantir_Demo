import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { ConfigProvider, Empty, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { getThemeCard, themeCardCssVariables, type ThemeCard } from './cards';
import { buildAntTheme } from './antTheme';
import { useShellPreferences } from '../hooks/useShellPreferences';

interface ThemeCardValue {
  card: ThemeCard;
  antTheme: ThemeConfig;
  canonTheme: ThemeConfig;
}

function themeValue(card: ThemeCard): ThemeCardValue {
  return { card, antTheme: buildAntTheme(card, 'root'), canonTheme: buildAntTheme(card, 'canon') };
}

const ThemeCardContext = createContext<ThemeCardValue>(themeValue(getThemeCard(undefined)));

const renderEmpty = (componentName?: string) => (
  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={componentName === 'Select' || componentName === 'Cascader' ? '暂无可选项' : '暂无数据'} />
);

export function ThemeCardProvider({ children }: { children: ReactNode }) {
  const { preferences } = useShellPreferences();
  const card = getThemeCard(preferences.theme);
  const value = useMemo(() => themeValue(card), [card]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [name, color] of Object.entries(themeCardCssVariables(card))) root.style.setProperty(name, color);
    root.dataset.themeCard = card.id;
    root.style.colorScheme = card.dark ? 'dark' : 'light';
    // Static message/modal/notification calls render outside the React tree.
    ConfigProvider.config({
      holderRender: holder => <ConfigProvider locale={zhCN} theme={value.antTheme}>{holder}</ConfigProvider>,
    });
  }, [card, value]);

  return (
    <ThemeCardContext.Provider value={value}>
      <ConfigProvider locale={zhCN} renderEmpty={renderEmpty} theme={value.antTheme}>{children}</ConfigProvider>
    </ThemeCardContext.Provider>
  );
}

export function useThemeCard() {
  return useContext(ThemeCardContext);
}

/** Lists, filters and component frames: the root theme's component tokens cannot be overridden by a nested global token. */
export function CanonThemeScope({ children }: { children: ReactNode }) {
  const { canonTheme } = useThemeCard();
  const scoped = useMemo(() => ({ ...canonTheme, inherit: false }), [canonTheme]);
  return <ConfigProvider theme={scoped} button={{ autoInsertSpace: false }}>{children}</ConfigProvider>;
}
