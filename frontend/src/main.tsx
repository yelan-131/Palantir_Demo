import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, Empty } from 'antd';
import type { ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './index.css';
import './shell.css';
import './workspace.css';
import './responsive.css';
import './pages/AccountCenter/preferences.css';
import { TECH_WHITE_PALETTE as colors, TECH_WHITE_GEOMETRY as geometry, TECH_WHITE_TYPOGRAPHY as typography, SHELL_COLOR_VARIABLES } from './theme/techWhite';

for (const [name, value] of Object.entries(SHELL_COLOR_VARIABLES)) {
  document.documentElement.style.setProperty(name, value);
}

const techWhiteTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorInfo: colors.primary,
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.danger,
    colorSuccessBg: colors.successBg,
    colorSuccessBorder: colors.successBorder,
    colorWarningBg: colors.warningBg,
    colorWarningBorder: colors.warningBorder,
    colorErrorBg: colors.dangerBg,
    colorErrorBorder: colors.dangerBorder,
    colorInfoBg: colors.infoBg,
    colorInfoBorder: colors.infoBorder,
    colorText: colors.text,
    colorTextSecondary: colors.muted,
    colorBgBase: colors.canvas,
    colorBgContainer: colors.surface,
    colorBorder: colors.border,
    colorBorderSecondary: colors.border,
    borderRadius: geometry.controlRadius,
    boxShadowSecondary: '0 8px 24px rgba(31, 44, 52, 0.08)',
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    fontSizeSM: typography.auxiliary,
    fontSizeHeading3: typography.pageTitle,
    fontSizeHeading4: typography.sectionTitle,
    fontSizeHeading5: typography.body,
    fontWeightStrong: 600,
    lineHeight: typography.lineHeight,
  },
  components: {
    Button: {
      borderRadius: geometry.controlRadius,
      controlHeight: geometry.controlHeight,
      fontWeight: 500,
      defaultColor: colors.text,
      defaultBorderColor: colors.border,
      defaultHoverBg: colors.hover,
      defaultHoverColor: colors.text,
      defaultHoverBorderColor: colors.borderStrong,
      defaultActiveBg: colors.selected,
      defaultActiveColor: colors.text,
      defaultActiveBorderColor: colors.borderStrong,
      defaultShadow: 'none',
      primaryShadow: 'none',
      dangerShadow: 'none',
    },
    Card: {
      borderRadiusLG: geometry.panelRadius,
      paddingLG: geometry.panelPadding,
    },
    Modal: {
      borderRadiusLG: geometry.panelRadius,
      headerBg: colors.surface,
      contentBg: colors.surface,
      footerBg: colors.surface,
      titleColor: colors.text,
      titleFontSize: 16,
    },
    Drawer: {
      footerPaddingBlock: 16,
      footerPaddingInline: 24,
    },
    Form: {
      labelColor: colors.text,
      labelFontSize: 13,
      itemMarginBottom: 16,
      verticalLabelPadding: '0 0 8px',
    },
    Select: {
      optionSelectedBg: colors.selected,
      optionSelectedColor: colors.text,
      optionSelectedFontWeight: 600,
      optionActiveBg: colors.hover,
      optionPadding: '8px 12px',
      multipleItemBg: colors.hover,
      multipleItemBorderColor: colors.border,
    },
    Dropdown: { borderRadiusLG: geometry.panelRadius, paddingBlock: 6 },
    Tabs: {
      itemColor: colors.muted,
      itemSelectedColor: colors.text,
      itemHoverColor: colors.text,
      itemActiveColor: colors.text,
      inkBarColor: colors.primary,
      cardBg: colors.rail,
    },
    Tag: { defaultBg: colors.rail, defaultColor: colors.muted },
    Alert: { defaultPadding: '12px 16px', withDescriptionPadding: '16px', withDescriptionIconSize: 20 },
    Message: { contentBg: colors.surface, contentPadding: '12px 16px' },
    Notification: { colorBgElevated: colors.surface, borderRadiusLG: geometry.panelRadius },
    Table: {
      cellFontSize: typography.body,
      cellFontSizeMD: typography.compact,
      cellFontSizeSM: typography.compact,
      headerBg: colors.rail,
      headerColor: colors.text,
      rowHoverBg: colors.hover,
      rowSelectedBg: colors.selected,
      rowSelectedHoverBg: colors.selected,
      borderColor: colors.border,
      headerBorderRadius: geometry.panelRadius,
      headerSortHoverBg: colors.hover,
      headerSortActiveBg: colors.selected,
      bodySortBg: colors.menu,
    },
    Menu: {
      itemBorderRadius: 10,
      itemHeight: 36,
    },
  },
};

const renderEmpty = (componentName?: string) => (
  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={componentName === 'Select' || componentName === 'Cascader' ? '暂无可选项' : '暂无数据'} />
);

ConfigProvider.config({
  holderRender: children => <ConfigProvider locale={zhCN} theme={techWhiteTheme}>{children}</ConfigProvider>,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      renderEmpty={renderEmpty}
      theme={techWhiteTheme}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
