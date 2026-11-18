import { Button, Col, Empty, Form, Row, Table, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import FieldControl from '@/components/FormWidgets/FieldControl';
import WidgetFrame from '@/pages/ComponentPages/WidgetFrame';
import { resolvePresentation } from '@/pages/ComponentPages/presentation';
import ProfessionalFlowDesigner, { createDefaultFlowConfig } from '@/pages/FormSettings/ProfessionalFlowDesigner';
import { normalizeProfessionalFlowConfig } from '@/pages/FormSettings/workflowConfig';
import '@/pages/FormSettings/style.css';
import { useAiWorkbench } from './context';
import type { DesignPreview } from './designPreview';
import './designPreview.css';

const fieldControls: Record<string, string> = {
  text: 'textarea', integer: 'number', decimal: 'number', float: 'number', enum: 'select',
  boolean: 'switch', attachment: 'upload',
};
const widgetLabels: Record<string, string> = {
  'record-list': '业务列表', 'record-filter': '筛选', metric: '指标卡', chart: '图表', workspace: '工作台',
};

function FormPreview({ preview }: { preview: Extract<DesignPreview, {kind: 'form'}> }) {
  return <Form layout="vertical" className="ai-design-preview-form">
    <Row gutter={[16, 4]}>
      {preview.fields.map(field => <Col key={field.name} xs={24} md={12}>
        <Form.Item label={<>{field.label}{field.proposed && <Tag>新增</Tag>}</>} required={field.required}>
          <FieldControl disabled preview label={field.label} type={fieldControls[field.type] || field.type} options={field.options} />
        </Form.Item>
      </Col>)}
    </Row>
    {!preview.fields.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无字段" />}
  </Form>;
}

function WorkflowPreview({ preview }: { preview: Extract<DesignPreview, {kind: 'workflow'}> }) {
  const fields = preview.fields.map(field => ({ key: field.name, name: field.label, type: field.type, required: field.required }));
  const defaults = createDefaultFlowConfig({ formId: String(preview.formId), formName: preview.title, version: '', steps: [], fields });
  const design = normalizeProfessionalFlowConfig(preview.design, defaults);
  return <fieldset disabled className="ai-design-preview-flow">
    <ProfessionalFlowDesigner config={design} fields={fields} roles={[]} externalInspector onChange={() => {}} />
  </fieldset>;
}

function PagePreview({ definition }: { definition: Extract<DesignPreview, {kind: 'page'}>['definition'] }) {
  const gap = definition.style?.componentGap ?? 12;
  return <section className="ai-design-preview-page" style={{ background: definition.style?.background || undefined }} aria-label="业务页面布局预览">
    <Row gutter={[gap, gap]}>
      {definition.widgets.map(widget => <Col key={widget.id} xs={24} lg={widget.width}
        style={widget.customWidth ? { flex: `0 0 ${widget.customWidth}px`, maxWidth: '100%' } : undefined}>
        <WidgetFrame heading={widget.title} description={widget.appearance?.subtitle}
          presentation={resolvePresentation(definition, widget)}
          canon={widget.type === 'record-list' || widget.type === 'record-filter'}
          style={{ minHeight: widget.customHeight ?? undefined }}>
          {widget.type === 'record-list' && widget.listSettings?.columns?.length
            ? <Table size="small" pagination={false} dataSource={[]} locale={{ emptyText: '布局预览' }}
                columns={widget.listSettings.columns.map(field => ({ key: field, title: field }))} />
            : <Typography.Text type="secondary">{widgetLabels[widget.type] || widget.type}</Typography.Text>}
        </WidgetFrame>
      </Col>)}
    </Row>
    {!definition.widgets.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无组件" />}
  </section>;
}

export default function WorkbenchDesignPreview({ children }: { children: ReactNode }) {
  const { designPreview } = useAiWorkbench();
  const location = useLocation();
  const navigate = useNavigate();
  const preview = designPreview?.preview;
  if (!preview || location.state?.aiDesignPreviewId !== preview.id) return <>{children}</>;
  return <section className="ai-design-preview" aria-label="AI 设计预览">
    <header className="ai-design-preview-header">
      <Typography.Title level={4}>{preview.title}</Typography.Title>
      <Typography.Text type="secondary">草稿预览 · 未保存</Typography.Text>
      <Button size="small" onClick={() => navigate(designPreview.returnTo, { replace: true })}>关闭预览</Button>
    </header>
    {preview.kind === 'form' && <FormPreview preview={preview} />}
    {preview.kind === 'workflow' && <WorkflowPreview preview={preview} />}
    {preview.kind === 'page' && <PagePreview definition={preview.definition} />}
  </section>;
}
