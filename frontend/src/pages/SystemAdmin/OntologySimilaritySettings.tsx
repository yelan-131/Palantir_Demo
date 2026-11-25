import { useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Typography, message } from 'antd';
import { updateOntologySimilarityFeatures, type OntologySimilarityFeature } from '../../services/api';
import { objectRuntimeError } from '../../services/objectRuntime';
import type { OntologyObject } from './semanticAssetShared';

const numericTypes = new Set(['number', 'int', 'integer', 'smallint', 'bigint', 'float', 'float32', 'float64',
  'decimal', 'numeric', 'double', 'double_precision', 'real']);
const categoryTypes = new Set(['string', 'text', 'short_text', 'long_text', 'varchar', 'char', 'enum',
  'select', 'single_select', 'boolean', 'bool', 'radio']);

type FeatureDraft = Omit<OntologySimilarityFeature, 'kind'>;
type FeatureFormValues = { features: FeatureDraft[] };

function fieldKind(field: OntologyObject['fields'][number]): OntologySimilarityFeature['kind'] | undefined {
  if (field.status && field.status !== 'published') return undefined;
  const type = field.type.trim().toLowerCase().replace(/[ -]/g, '_');
  if (numericTypes.has(type)) return 'number';
  if (categoryTypes.has(type)) return 'category';
  return undefined;
}

const positiveValue = {
  validator: (_: unknown, value?: number | null) => value == null || (Number.isFinite(value) && value > 0)
    ? Promise.resolve() : Promise.reject(new Error('请输入大于 0 的数值')),
};

export default function OntologySimilaritySettings({ object, onSaved }: { object: OntologyObject; onSaved: () => Promise<void> }) {
  const [form] = Form.useForm<FeatureFormValues>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fields = object.fields.flatMap(field => {
    const kind = fieldKind(field);
    return kind ? [{ value: field.code ?? field.name, label: field.label || field.name, kind }] : [];
  });
  const selected: FeatureDraft[] = Form.useWatch('features', form) ?? [];
  const objectId = Number(object.db_id ?? object.id);

  function openSettings() {
    setError('');
    form.resetFields();
    form.setFieldValue('features', object.similarity_features ?? []);
    setOpen(true);
  }

  async function save({ features }: FeatureFormValues) {
    if (saving) return;
    const configuration: OntologySimilarityFeature[] = [];
    for (const { code, dimension, tolerance, weight, scale, offset } of features ?? []) {
      const kind = fields.find(field => field.value === code)?.kind;
      if (!kind) {
        setError('请选择可比较的已发布属性');
        return;
      }
      configuration.push({
        code, kind, dimension: dimension?.trim() || undefined, weight: weight ?? undefined,
        ...(kind === 'number' && { tolerance, scale: scale ?? undefined, offset: offset ?? undefined }),
      });
    }
    const shared = configuration.flatMap(feature => feature.dimension ? [feature.dimension] : []);
    if (new Set(configuration.map(feature => feature.code)).size !== configuration.length || new Set(shared).size !== shared.length) {
      setError('同一个对象中的属性和共享维度只能分别配置一次');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await updateOntologySimilarityFeatures(objectId, configuration);
      setOpen(false);
      message.success('相似特征已保存');
      await onSaved().catch(() => message.warning('配置已保存，请刷新对象模型查看。'));
    } catch (cause) {
      setError(objectRuntimeError(cause, '无法保存相似特征'));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <Button size="small" onClick={openSettings} disabled={!Number.isSafeInteger(objectId) || objectId <= 0}>相似特征</Button>
    <Modal title={`${object.name} · 相似特征`} open={open} forceRender width={740} okText="保存"
      confirmLoading={saving} onOk={() => form.submit()} onCancel={() => !saving && setOpen(false)}>
      <Typography.Paragraph type="secondary">选择影响关系图中对象间距的属性。跨类型比较时填写相同的共享维度，并统一数值口径。</Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" onFinish={save} initialValues={{ features: [] }} disabled={saving}>
        <Form.List name="features">
          {(rows, { add, remove }) => <>
            {rows.map(({ key, name }) => {
              const current = selected[name]?.code;
              const kind = fields.find(field => field.value === current)?.kind;
              const used = new Set(selected.flatMap((feature, index) => index === name ? [] : [feature?.code]));
              return <Card key={key} size="small" style={{ marginBottom: 10 }}>
                <Row gutter={12} align="bottom">
                  <Col xs={24} sm={10}>
                    <Form.Item name={[name, 'code']} label="属性" rules={[{ required: true, message: '请选择属性' }]}>
                      <Select options={fields.filter(field => !used.has(field.value))} placeholder="选择已发布的属性" showSearch optionFilterProp="label" />
                    </Form.Item>
                  </Col>
                  <Col xs={18} sm={10}>
                    <Form.Item name={[name, 'dimension']} label="共享维度" tooltip="留空时仅与同一类型比较。不同类型填同一个维度编码即可比较。">
                      <Input placeholder="选填，例如 plan_quantity" maxLength={120} />
                    </Form.Item>
                  </Col>
                  <Col xs={6} sm={4}>
                    <Form.Item><Button danger type="link" onClick={() => remove(name)}>移除</Button></Form.Item>
                  </Col>
                </Row>
                {kind && <Row gutter={12}>
                  {kind === 'number' && <Col xs={12} sm={6}>
                    <Form.Item name={[name, 'tolerance']} label="数值容差" tooltip="在换算后的单位下衡量差值，容差越大，同样差值的相似度越高。"
                      rules={[{ required: true, message: '请输入容差' }, positiveValue]}>
                      <InputNumber style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>}
                  <Col xs={12} sm={6}>
                    <Form.Item name={[name, 'weight']} label="特征权重" rules={[positiveValue]}>
                      <InputNumber style={{ width: '100%' }} placeholder="默认 1" />
                    </Form.Item>
                  </Col>
                  {kind === 'number' ? <>
                    <Col xs={12} sm={6}>
                      <Form.Item name={[name, 'scale']} label="换算系数" tooltip="原始值先乘系数，再加偏移。" rules={[positiveValue]}>
                        <InputNumber style={{ width: '100%' }} placeholder="默认 1" />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Form.Item name={[name, 'offset']} label="换算偏移">
                        <InputNumber style={{ width: '100%' }} placeholder="默认 0" />
                      </Form.Item>
                    </Col>
                  </> : <Col xs={12} sm={18}><Form.Item label="比较方式"><Typography.Text>分类值相等</Typography.Text></Form.Item></Col>}
                </Row>}
              </Card>;
            })}
            <Button type="dashed" onClick={() => add()} disabled={rows.length >= Math.min(fields.length, 120)}>添加特征</Button>
          </>}
        </Form.List>
      </Form>
    </Modal>
  </>;
}
