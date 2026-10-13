import React from 'react';
import { DeleteOutlined, DragOutlined } from '@ant-design/icons';
import type { WidgetInstance } from './types';
import { TECH_WHITE_PALETTE as colors, TECH_WHITE_GEOMETRY as geometry } from '../../theme/techWhite';

interface Props {
  widget: WidgetInstance;
  isEditing: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}

export default function WidgetWrapper({ widget, isEditing, isSelected, onSelect, onDelete, children }: Props) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      style={{
        position: 'absolute',
        left: `${(widget.position.x / 24) * 100}%`,
        top: `${widget.position.y * 50}px`,
        width: `${(widget.position.w / 24) * 100}%`,
        height: `${widget.position.h * 50}px`,
        background: colors.surface,
        border: isSelected ? `2px solid ${colors.primary}` : `1px solid ${colors.border}`,
        borderRadius: geometry.panelRadius,
        overflow: 'hidden',
        cursor: isEditing ? 'move' : 'default',
        boxShadow: 'none',
        transition: 'box-shadow 0.2s, border-color 0.2s',
      }}
    >
      {isEditing && (
        <div
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: 24, background: isSelected ? colors.primary : colors.rail,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 8px', fontSize: 12, zIndex: 10,
            color: isSelected ? colors.surface : colors.muted,
          }}
        >
          <span><DragOutlined style={{ marginRight: 4 }} />{widget.title || widget.type}</span>
          {isSelected && (
            <DeleteOutlined
              style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            />
          )}
        </div>
      )}
      <div style={{ padding: isEditing ? '24px 8px 8px' : 8, height: isEditing ? 'calc(100% - 24px)' : '100%' }}>
        {children}
      </div>
    </div>
  );
}
