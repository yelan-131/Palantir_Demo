import { Button, ColorPicker, Input, InputNumber, Select, Switch } from 'antd';
import { CopyOutlined, DeleteOutlined } from '@/components/Icon/ant';
import { PropertyGroup, PropertyRow } from '@/components/PropertyInspector';
import { widgetFontOptions } from '../AppPrograms/analyticsWidgetAppearance';
import { FLOW_ANNOTATION_APPEARANCE, FLOW_ANNOTATION_TITLE_LIMIT, type FlowAnnotation, type FlowAnnotationBorderStyle } from './flowAnnotations';

const { fontSize, backgroundOpacity, borderWidth, borderRadius } = FLOW_ANNOTATION_APPEARANCE;
const borderOptions: { value: FlowAnnotationBorderStyle; label: string }[] = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'none', label: '无边框' },
];

function colorInput(value: string | undefined, onChange: (value: string | undefined) => void, fallback?: string, disabled = false) {
  return <ColorPicker disabledAlpha size="small" allowClear={Boolean(value)} disabled={disabled}
    value={value ?? fallback ?? ''}
    showText={(color) => value || fallback ? color.toHexString().toUpperCase() : '默认'}
    onClear={() => onChange(undefined)}
    onChangeComplete={(color) => {
      const next = color.toHexString();
      if (next !== (value ?? fallback)) onChange(next);
    }} />;
}

export function FlowAnnotationProperties({ annotation, onChange, onCopy, onDelete }: {
  annotation: FlowAnnotation;
  onChange: (patch: Partial<FlowAnnotation>) => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const { titleStyle, frameStyle } = annotation;
  const patchTitle = (patch: NonNullable<FlowAnnotation['titleStyle']>) => onChange({ titleStyle: { ...titleStyle, ...patch } });
  const patchFrame = (patch: NonNullable<FlowAnnotation['frameStyle']>) => onChange({ frameStyle: { ...frameStyle, ...patch } });
  const hasBorder = frameStyle?.borderStyle !== 'none';

  return (
    <div className="professional-flow-props">
      <PropertyGroup title="注释标题">
        <PropertyRow label="标题文字">
          <Input maxLength={FLOW_ANNOTATION_TITLE_LIMIT} value={annotation.title}
            onChange={(event) => onChange({ title: event.target.value })} />
        </PropertyRow>
        <PropertyRow label="字体">
          <Select value={titleStyle?.fontFamily ?? 'inherit'} options={widgetFontOptions}
            onChange={(fontFamily) => patchTitle({ fontFamily })} />
        </PropertyRow>
        <PropertyRow label="字号">
          <InputNumber min={fontSize.min} max={fontSize.max} precision={0} suffix="px" value={titleStyle?.fontSize ?? fontSize.initial}
            onChange={(value) => patchTitle({ fontSize: value ?? undefined })} />
        </PropertyRow>
        <PropertyRow label="文字颜色">
          {colorInput(titleStyle?.color, (color) => patchTitle({ color }))}
        </PropertyRow>
        <PropertyRow label="加粗">
          <Switch size="small" checked={titleStyle?.bold ?? true} onChange={(bold) => patchTitle({ bold })} />
        </PropertyRow>
        <PropertyRow label="斜体">
          <Switch size="small" checked={titleStyle?.italic ?? false} onChange={(italic) => patchTitle({ italic })} />
        </PropertyRow>
        <PropertyRow label="下划线">
          <Switch size="small" checked={titleStyle?.underline ?? false} onChange={(underline) => patchTitle({ underline })} />
        </PropertyRow>
      </PropertyGroup>
      <PropertyGroup title="容器外观">
        <PropertyRow label="背景颜色">
          {colorInput(frameStyle?.backgroundColor, (backgroundColor) => patchFrame({ backgroundColor }), annotation.color)}
        </PropertyRow>
        <PropertyRow label="背景不透明度">
          <InputNumber min={backgroundOpacity.min} max={backgroundOpacity.max} precision={0} suffix="%"
            value={frameStyle?.backgroundOpacity ?? backgroundOpacity.initial}
            onChange={(value) => patchFrame({ backgroundOpacity: value ?? undefined })} />
        </PropertyRow>
        <PropertyRow label="边框样式">
          <Select value={frameStyle?.borderStyle ?? 'solid'} options={borderOptions}
            onChange={(borderStyle) => patchFrame({ borderStyle })} />
        </PropertyRow>
        <PropertyRow label="边框颜色">
          {colorInput(frameStyle?.borderColor, (borderColor) => patchFrame({ borderColor }), annotation.color, !hasBorder)}
        </PropertyRow>
        <PropertyRow label="边框粗细">
          <InputNumber disabled={!hasBorder} min={borderWidth.min} max={borderWidth.max} precision={0} suffix="px"
            value={frameStyle?.borderWidth ?? borderWidth.initial} onChange={(value) => patchFrame({ borderWidth: value ?? undefined })} />
        </PropertyRow>
        <PropertyRow label="容器圆角">
          <InputNumber min={borderRadius.min} max={borderRadius.max} precision={0} suffix="px"
            value={frameStyle?.borderRadius ?? borderRadius.initial} onChange={(value) => patchFrame({ borderRadius: value ?? undefined })} />
        </PropertyRow>
        <div className="professional-flow-property-actions">
          <Button size="small" icon={<CopyOutlined />} onClick={onCopy}>复制注释</Button>
          <Button danger size="small" icon={<DeleteOutlined />} onClick={onDelete}>删除注释</Button>
        </div>
      </PropertyGroup>
    </div>
  );
}
