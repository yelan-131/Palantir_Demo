import { useEffect, useState } from 'react';
import { Form, Input, InputNumber, Select, Divider, Typography, Space } from 'antd';
import type { WidgetInstance, WidgetFieldConfig } from '../ReportWidgets/types';
import { listModels } from '@/services/api';

interface ModelOption {
  id: number;
  name: string;
  label: string;
  fields: { field_name: string; label: string; field_type: string }[];
}

interface Props {
  widget: WidgetInstance | null;
  onChange: (updated: WidgetInstance) => void;
}

export default function ConfigPanel({ widget, onChange }: Props) {
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    listModels()
      .then((res) => {
        const data = res.data?.data || [];
        setModels(data);
      })
      .catch(() => {});
  }, []);

  if (!widget) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: '#999' }}>
        选择画布中的组件进行配置
      </div>
    );
  }

  const ds = widget.dataSource || { endpoint: '', path: '', params: {} };
  const fc = widget.fieldConfig || {};
  const isFormWidget = widget.type.startsWith('form-');

  const handleFieldChange = (field: string, value: unknown) => {
    onChange({ ...widget, [field]: value });
  };

  const handleDsChange = (field: string, value: unknown) => {
    onChange({
      ...widget,
      dataSource: { ...widget.dataSource, [field]: value } as any,
    });
  };

  const handleStyleChange = (field: string, value: unknown) => {
    onChange({
      ...widget,
      style: { ...(widget.style || {}), [field]: value },
    });
  };

  const handlePositionChange = (field: string, value: number) => {
    onChange({
      ...widget,
      position: { ...widget.position, [field]: value },
    });
  };

  const handleFieldConfigChange = (field: keyof WidgetFieldConfig, value: unknown) => {
    onChange({
      ...widget,
      fieldConfig: { ...widget.fieldConfig, [field]: value },
    });
  };

  const selectedModel = models.find((m) => m.name === fc.model_name);
  const modelFields = selectedModel?.fields || [];

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>属性配置</Typography.Text>

      <Form layout="vertical" size="small">
        <Form.Item label="标题">
          <Input value={widget.title} onChange={(e) => handleFieldChange('title', e.target.value)} />
        </Form.Item>

        <Divider orientation="left" plain style={{ margin: '8px 0', fontSize: 12 }}>位置</Divider>

        <Space size={8}>
          <Form.Item label="X">
            <InputNumber min={0} max={24} value={widget.position.x} onChange={(v) => v != null && handlePositionChange('x', v)} />
          </Form.Item>
          <Form.Item label="Y">
            <InputNumber min={0} value={widget.position.y} onChange={(v) => v != null && handlePositionChange('y', v)} />
          </Form.Item>
          <Form.Item label="宽">
            <InputNumber min={2} max={24} value={widget.position.w} onChange={(v) => v != null && handlePositionChange('w', v)} />
          </Form.Item>
          <Form.Item label="高">
            <InputNumber min={2} max={20} value={widget.position.h} onChange={(v) => v != null && handlePositionChange('h', v)} />
          </Form.Item>
        </Space>

        {isFormWidget && (
          <>
            <Divider orientation="left" plain style={{ margin: '8px 0', fontSize: 12 }}>字段绑定</Divider>

            <Form.Item label="绑定模型">
              <Select
                showSearch
                allowClear
                placeholder="选择关联的模型"
                value={fc.model_name || undefined}
                onChange={(v) => {
                  handleFieldConfigChange('model_name', v);
                  handleFieldConfigChange('field_name', undefined);
                }}
                options={models.map((m) => ({ label: m.label || m.name, value: m.name }))}
                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              />
            </Form.Item>

            {fc.model_name && (
              <Form.Item label="绑定字段">
                <Select
                  showSearch
                  allowClear
                  placeholder="选择绑定的字段"
                  value={fc.field_name || undefined}
                  onChange={(v) => {
                    const f = modelFields.find((x) => x.field_name === v);
                    handleFieldConfigChange('field_name', v);
                    if (f) {
                      handleFieldConfigChange('label', f.label);
                      handleFieldConfigChange('field_type', f.field_type);
                    }
                  }}
                  options={modelFields.map((f) => ({ label: `${f.label} (${f.field_type})`, value: f.field_name }))}
                  filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                />
              </Form.Item>
            )}

            {fc.field_name && (
              <Form.Item label="字段标签">
                <Input
                  value={fc.label || ''}
                  onChange={(e) => handleFieldConfigChange('label', e.target.value)}
                  placeholder="显示名称"
                />
              </Form.Item>
            )}
          </>
        )}

        {!isFormWidget && (
          <>
            <Divider orientation="left" plain style={{ margin: '8px 0', fontSize: 12 }}>数据源</Divider>

            <Form.Item label="API 端点">
              <Input
                placeholder="/api/v1/dashboard/overview"
                value={ds.endpoint || ''}
                onChange={(e) => handleDsChange('endpoint', e.target.value)}
              />
            </Form.Item>
            <Form.Item label="数据路径">
              <Input
                placeholder="如 equipment.total"
                value={ds.path || ''}
                onChange={(e) => handleDsChange('path', e.target.value)}
              />
            </Form.Item>
          </>
        )}

        {widget.type === 'kpi-card' && (
          <>
            <Divider orientation="left" plain style={{ margin: '8px 0', fontSize: 12 }}>样式</Divider>
            <Form.Item label="颜色">
              <Input
                type="color"
                value={(widget.style?.color as string) || '#1677ff'}
                onChange={(e) => handleStyleChange('color', e.target.value)}
                style={{ width: 60, padding: 2 }}
              />
            </Form.Item>
          </>
        )}
      </Form>
    </div>
  );
}
