import { TECH_WHITE_PALETTE, TECH_WHITE_GEOMETRY } from '../../theme/techWhite';
import React from 'react';
import type { WidgetInstance, WidgetType } from '../ReportWidgets/types';
import { WIDGET_REGISTRY } from '../ReportWidgets/types';
import { renderWidget } from '../ReportWidgets/WidgetRegistry';

interface Props {
  widgets: WidgetInstance[];
  isEditing: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onAddWidget: (widget: WidgetInstance) => void;
  onWidgetChange: (widget: WidgetInstance) => void;
}

export default function DragCanvas({ widgets, isEditing, selectedId, onSelect, onDelete, onAddWidget }: Props) {
  const maxRow = widgets.reduce((max, w) => Math.max(max, w.position.y + w.position.h), 0);
  const canvasHeight = Math.max(400, (maxRow + 4) * 50);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('widget-type') as WidgetType;
    if (!type) return;

    const meta = WIDGET_REGISTRY.find((w) => w.type === type);
    if (!meta) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 24);
    const y = Math.round((e.clientY - rect.top) / 50);

    onAddWidget({
      id: `w-${Date.now()}`,
      type,
      title: meta.label,
      position: {
        x: Math.max(0, Math.min(24 - meta.defaultWidth, x)),
        y: Math.max(0, y),
        w: meta.defaultWidth,
        h: meta.defaultHeight,
      },
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  return (
    <div
      onClick={() => onSelect(null)}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      style={{
        position: 'relative',
        minHeight: canvasHeight,
        backgroundColor: TECH_WHITE_PALETTE.surface,
        backgroundImage: isEditing
          ? `repeating-linear-gradient(0deg, transparent, transparent 49px, ${TECH_WHITE_PALETTE.border} 49px, ${TECH_WHITE_PALETTE.border} 50px), repeating-linear-gradient(90deg, transparent, transparent calc(100%/24 - 1px), ${TECH_WHITE_PALETTE.border} calc(100%/24 - 1px), ${TECH_WHITE_PALETTE.border} calc(100%/24))`
          : 'none',
        borderRadius: TECH_WHITE_GEOMETRY.panelRadius,
        border: `1px dashed ${TECH_WHITE_PALETTE.borderStrong}`,
        overflow: 'hidden',
      }}
    >
      {widgets.length === 0 && isEditing && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: TECH_WHITE_PALETTE.faint, fontSize: 16, pointerEvents: 'none',
        }}>
          从左侧面板拖拽组件到此处，或点击组件添加
        </div>
      )}
      {widgets.map((w) =>
        renderWidget({
          widget: w,
          isEditing,
          isSelected: selectedId === w.id,
          onSelect: () => onSelect(w.id),
          onDelete: () => onDelete(w.id),
        })
      )}
    </div>
  );
}
