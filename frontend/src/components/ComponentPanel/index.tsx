import React from 'react';
import { Card, Typography, Divider } from 'antd';
import {
  DashboardOutlined,
  LineChartOutlined,
  BarChartOutlined,
  PieChartOutlined,
  TableOutlined,
  FontSizeOutlined,
  FormOutlined,
  NumberOutlined,
  DownCircleOutlined,
  CalendarOutlined,
  SwapOutlined,
  AlignLeftOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { WidgetType } from '../ReportWidgets/types';
import { WIDGET_REGISTRY, WIDGET_CATEGORIES } from '../ReportWidgets/types';

const ICON_MAP: Record<string, React.ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  LineChartOutlined: <LineChartOutlined />,
  BarChartOutlined: <BarChartOutlined />,
  PieChartOutlined: <PieChartOutlined />,
  TableOutlined: <TableOutlined />,
  FontSizeOutlined: <FontSizeOutlined />,
  FormOutlined: <FormOutlined />,
  NumberOutlined: <NumberOutlined />,
  DownCircleOutlined: <DownCircleOutlined />,
  CalendarOutlined: <CalendarOutlined />,
  SwapOutlined: <SwapOutlined />,
  AlignLeftOutlined: <AlignLeftOutlined />,
  LinkOutlined: <LinkOutlined />,
};

interface Props {
  onAddWidget: (type: WidgetType) => void;
}

export default function ComponentPanel({ onAddWidget }: Props) {
  return (
    <div style={{ padding: 12 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>组件面板</Typography.Text>
      {WIDGET_CATEGORIES.map((cat, idx) => {
        const widgets = WIDGET_REGISTRY.filter((w) => w.category === cat.key);
        return (
          <React.Fragment key={cat.key}>
            {idx > 0 && <Divider style={{ margin: '8px 0', fontSize: 11 }} plain>{cat.label}</Divider>}
            {idx === 0 && (
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>{cat.label}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {widgets.map((w) => (
                <Card
                  key={w.type}
                  size="small"
                  hoverable
                  style={{ cursor: 'grab' }}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('widget-type', w.type);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAddWidget(w.type)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16, color: '#1677ff' }}>{ICON_MAP[w.icon] || <DashboardOutlined />}</span>
                    <span style={{ fontSize: 12 }}>{w.label}</span>
                  </div>
                </Card>
              ))}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
