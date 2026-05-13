import React, { useState, useCallback, useEffect } from 'react';
import { Button, Space, Typography, message, Tooltip } from 'antd';
import {
  ArrowLeftOutlined, SaveOutlined, ExpandOutlined,
  CompressOutlined, UndoOutlined, RedoOutlined,
} from '@ant-design/icons';
import ComponentPanel from '@/components/ComponentPanel';
import ConfigPanel from '@/components/ConfigPanel';
import DragCanvas from '@/components/DragCanvas';
import type { WidgetInstance, WidgetType, ReportConfig } from '@/components/ReportWidgets/types';
import { WIDGET_REGISTRY } from '@/components/ReportWidgets/types';

interface Props {
  report: {
    id: number;
    name: string;
    description?: string;
    config?: ReportConfig;
  };
  onSave: (config: ReportConfig) => void;
  onBack: () => void;
  readOnly?: boolean;
}

export default function PageDesigner({ report, onSave, onBack, readOnly }: Props) {
  const [config, setConfig] = useState<ReportConfig>(
    report.config || { canvas: { gridSize: 8 }, widgets: [], filters: [] }
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<ReportConfig[]>([config]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [showPreview, setShowPreview] = useState(!!readOnly);

  const pushHistory = useCallback((newConfig: ReportConfig) => {
    setHistory((prev) => {
      const next = prev.slice(0, historyIdx + 1);
      next.push(newConfig);
      if (next.length > 30) next.shift();
      return next;
    });
    setHistoryIdx((prev) => Math.min(prev + 1, 30));
  }, [historyIdx]);

  const updateConfig = useCallback((newConfig: ReportConfig) => {
    setConfig(newConfig);
    pushHistory(newConfig);
  }, [pushHistory]);

  const handleUndo = () => {
    if (historyIdx > 0) {
      const newIdx = historyIdx - 1;
      setHistoryIdx(newIdx);
      setConfig(history[newIdx]);
    }
  };

  const handleRedo = () => {
    if (historyIdx < history.length - 1) {
      const newIdx = historyIdx + 1;
      setHistoryIdx(newIdx);
      setConfig(history[newIdx]);
    }
  };

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // Unsaved changes prompt
  const isDirty = historyIdx > 0;
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleAddWidget = (type: WidgetType) => {
    const meta = WIDGET_REGISTRY.find((w) => w.type === type);
    if (!meta) return;

    const maxRow = config.widgets.reduce((max, w) => Math.max(max, w.position.y + w.position.h), 0);

    const newWidget: WidgetInstance = {
      id: `w-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      type,
      title: meta.label,
      position: { x: 0, y: maxRow, w: meta.defaultWidth, h: meta.defaultHeight },
    };

    updateConfig({ ...config, widgets: [...config.widgets, newWidget] });
    setSelectedId(newWidget.id);
  };

  const handleDeleteWidget = (id: string) => {
    updateConfig({ ...config, widgets: config.widgets.filter((w) => w.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };

  const handleWidgetChange = (updated: WidgetInstance) => {
    updateConfig({
      ...config,
      widgets: config.widgets.map((w) => (w.id === updated.id ? updated : w)),
    });
  };

  const handleSave = () => {
    onSave(config);
  };

  const isEditing = !showPreview && !readOnly;
  const selectedWidget = config.widgets.find((w) => w.id === selectedId) || null;

  return (
    <div style={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', borderRadius: '8px 8px 0 0',
      }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>
          <Typography.Text strong>{report.name}</Typography.Text>
        </Space>
        <Space>
          {!readOnly && (
            <>
              <Tooltip title="撤销 (Ctrl+Z)">
                <Button icon={<UndoOutlined />} disabled={historyIdx === 0} onClick={handleUndo} />
              </Tooltip>
              <Tooltip title="重做 (Ctrl+Y)">
                <Button icon={<RedoOutlined />} disabled={historyIdx >= history.length - 1} onClick={handleRedo} />
              </Tooltip>
              <Button
                icon={showPreview ? <CompressOutlined /> : <ExpandOutlined />}
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? '编辑模式' : '预览模式'}
              </Button>
              <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
                保存
              </Button>
            </>
          )}
        </Space>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left panel: component palette */}
        {isEditing && (
          <div style={{ width: 180, borderRight: '1px solid #f0f0f0', overflow: 'auto', background: '#fafafa' }}>
            <ComponentPanel onAddWidget={handleAddWidget} />
          </div>
        )}

        {/* Canvas */}
        <div style={{ flex: 1, overflow: 'auto', padding: 12, background: '#f5f5f5' }}>
          <DragCanvas
            widgets={config.widgets}
            isEditing={isEditing}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={handleDeleteWidget}
            onAddWidget={(widget) => updateConfig({ ...config, widgets: [...config.widgets, widget] })}
            onWidgetChange={handleWidgetChange}
          />
        </div>

        {/* Right panel: config */}
        {isEditing && (
          <div style={{ width: 260, borderLeft: '1px solid #f0f0f0', overflow: 'auto', background: '#fafafa' }}>
            <ConfigPanel widget={selectedWidget} onChange={handleWidgetChange} />
          </div>
        )}
      </div>
    </div>
  );
}
