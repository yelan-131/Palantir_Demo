import React, { useEffect, useState } from 'react';
import { TECH_WHITE_PALETTE } from '../../theme/techWhite';
import { Statistic, Spin } from 'antd';
import {
  ToolOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  PoweroffOutlined,
  DashboardOutlined,
  FileTextOutlined,
  TeamOutlined,
  ShopOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import type { WidgetInstance } from './types';
import { fetchDataFromApi } from './WidgetRegistry';

const ICON_MAP: Record<string, React.ReactNode> = {
  ToolOutlined: <ToolOutlined />,
  CheckCircleOutlined: <CheckCircleOutlined />,
  WarningOutlined: <WarningOutlined />,
  PoweroffOutlined: <PoweroffOutlined />,
  DashboardOutlined: <DashboardOutlined />,
  FileTextOutlined: <FileTextOutlined />,
  TeamOutlined: <TeamOutlined />,
  ShopOutlined: <ShopOutlined />,
  DatabaseOutlined: <DatabaseOutlined />,
};

interface Props {
  widget: WidgetInstance;
  isEditing: boolean;
}

export default function KPICardWidget({ widget, isEditing }: Props) {
  const [value, setValue] = useState<number | string>('--');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isEditing || !widget.dataSource?.endpoint) return;
    let cancelled = false;
    setLoading(true);
    fetchDataFromApi(widget.dataSource)
      .then((data) => {
        if (cancelled) return;
        if (widget.dataSource?.path) {
          const parts = widget.dataSource.path.split('.');
          let val: unknown = data;
          for (const p of parts) {
            val = (val as Record<string, unknown>)?.[p];
          }
          setValue(typeof val === 'number' ? val : typeof val === 'string' ? val : '--');
        } else {
          setValue(typeof data === 'number' ? data : '--');
        }
      })
      .catch(() => { if (!cancelled) setValue('--'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [widget.dataSource, isEditing]);

  const color = (widget.style?.color as string) || TECH_WHITE_PALETTE.primary;
  const iconStr = (widget.style?.icon as string) || 'DashboardOutlined';

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {loading ? <Spin /> : (
        <Statistic
          title={widget.title}
          value={value}
          valueStyle={{ color, fontSize: value === '--' ? 20 : 28 }}
          prefix={ICON_MAP[iconStr] || <DashboardOutlined />}
        />
      )}
    </div>
  );
}
