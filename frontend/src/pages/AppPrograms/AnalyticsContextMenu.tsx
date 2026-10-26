import React from 'react';
import type { MenuProps } from 'antd';
import { EditOutlined, FilterOutlined, SettingOutlined, SkinOutlined } from '@ant-design/icons';

interface ContextMenuOptions {
  widgetTitle?: string;
  pageLabel: '看板' | '页面';
  sections: NonNullable<MenuProps['items']>;
}

/** Share presentation while keeping each workspace's existing action keys. */
export function buildAnalyticsContextMenu({ widgetTitle, pageLabel, sections }: ContextMenuOptions): NonNullable<MenuProps['items']> {
  const isWidget = widgetTitle !== undefined;
  return [
    {
      key: 'context', type: 'group',
      label: <span className="analytics-context-heading" title={widgetTitle || pageLabel}>{widgetTitle || pageLabel}</span>,
      children: [
        { key: 'edit', icon: <EditOutlined />, label: isWidget ? '编辑此组件' : `编辑${pageLabel}` },
        ...(isWidget ? [
          { key: 'widget-style', icon: <SkinOutlined />, label: '调整外观' },
          { key: 'widget-interaction', icon: <FilterOutlined />, label: '设置交互' },
        ] : []),
      ],
    },
    { type: 'divider' },
    ...(isWidget ? [{ key: 'page', icon: <SettingOutlined />,
      popupClassName: 'analytics-context-submenu', label: `${pageLabel}设置`, children: sections,
    }] : sections),
  ];
}
