import { Alert, Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { objectRuntimeError, objectTypeId, readObjectRecord, type RuntimeObjectType } from '../../services/objectRuntime';
import { RelationshipPdfAttachment, relationshipPdfAttachments } from './RelationshipAttachmentImages';
import RelationshipAttributeEvidence from './RelationshipAttributeEvidence';
import { relationshipNodeId, type RelationshipNode } from './relationshipGraph';
import { relationshipNodeLabel } from './relationshipCardDetails';
import { reviewRelationshipMaterialParameters } from './relationshipMaterialParameterReview';

export default function RelationshipMaterialReviewPanel({ product, productModel, materialModel, materialKey, relatedTests, fromQuery = false }: {
  product: RelationshipNode;
  productModel: RuntimeObjectType;
  materialModel?: RuntimeObjectType;
  materialKey: string;
  relatedTests: readonly RelationshipNode[];
  fromQuery?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ id: string; node?: RelationshipNode; error?: string }>();
  const materialTypeId = materialModel && objectTypeId(materialModel);
  const materialTypeName = materialModel?.name;
  const expectedId = materialTypeId && relationshipNodeId(materialTypeId, materialKey);
  const current = loaded?.id === expectedId ? loaded : undefined;

  useEffect(() => {
    if (!expectedId || !materialTypeId || !materialTypeName) return;
    const controller = new AbortController();
    readObjectRecord(materialTypeId, materialKey, controller.signal).then(({ data: { data: record } }) => {
      if (controller.signal.aborted) return;
      setLoaded({ id: expectedId, node: {
        id: expectedId, typeId: materialTypeId, typeName: materialTypeName, key: record.key, values: record.values,
        maskedFields: record.masked_fields, recordMetadata: record.record_metadata, bindingForm: record.binding_form, level: 1,
      } });
    }).catch(error => {
      if (!controller.signal.aborted) setLoaded({ id: expectedId, error: objectRuntimeError(error, '无法读取对照材料。') });
    });
    return () => controller.abort();
  }, [expectedId, materialKey, materialTypeId, materialTypeName]);

  const material = current?.node;
  const report = material && materialModel
    ? reviewRelationshipMaterialParameters(product, productModel, material, materialModel, relatedTests) : undefined;
  const file = material?.maskedFields?.includes('material_datasheet') ? undefined : relationshipPdfAttachments(material?.values.material_datasheet)[0];
  const gasBurst = report?.productMeasurements.find(item => /气体.*爆破/.test(item.label));
  const tensile = report?.materialEvidence.find(item => item.label === '拉伸强度');
  const ribWidth = report?.productMeasurements.find(item => item.key === 'weld_rib_width_mm');
  const shrinkage = report?.materialEvidence.find(item => item.label === '成型收缩率');
  const title = fromQuery ? '材料查询结果' : '牌号留空选材试算';
  const productName = relationshipNodeLabel(product);

  return <section className="relationship-material-review" aria-label={title}>
    <header><h3>{title}</h3>{report && <Tag color={report.comparableCount ? 'blue' : 'gold'}>
      {report.comparableCount ? '有可比参数' : '待补要求'}
    </Tag>}</header>
    <p><strong>{productName}</strong>按牌号留空试算{materialModel ? <>，对照 <strong>{materialKey}</strong> 的物性表。</> : '。'}</p>
    {material && file && <RelationshipPdfAttachment objectId={material.typeId} recordKey={material.key}
      property="material_datasheet" file={file} label="下载 BK220C 物性表 PDF" />}
    {(!materialModel || current?.error) && <Alert type="warning" showIcon message={current?.error ?? '当前无法查看对照材料。'} />}
    {materialModel && !current && <Spin size="small" />}
    {material && report && <>
      <dl>
        <dt>已检查物性指标</dt><dd>{report.metricChecks.length} 项</dd>
        <dt>可直接比较</dt><dd><strong>{report.comparableCount} 项</strong></dd>
        <dt>参数选材结论</dt><dd>{report.comparableCount ? '按可比项逐项核对' : '材料待定'}</dd>
        {!report.comparableCount && <><dt>材料候选连线</dt><dd>暂无</dd></>}
      </dl>
      {report.comparison && <RelationshipAttributeEvidence comparison={report.comparison} source={product} target={material} />}
      {fromQuery && relatedTests.length > 0 && <section aria-label="高亮的记录依据">
        <h4>高亮的记录依据</h4>
        <ul>{relatedTests.map(test => <li key={test.id}>{relationshipNodeLabel(test)} <code>{test.key}</code></li>)}</ul>
      </section>}
      {gasBurst && tensile && <section aria-label="测量对象不同">
        <h4>测量对象不同</h4>
        <dl>
          <dt>整阀气体爆破压力</dt><dd>{gasBurst.value}</dd>
          <dt>材料试片拉伸强度</dt><dd>{tensile.value}</dd>
        </dl>
      </section>}
      {ribWidth && shrinkage && <section aria-label="尺寸与收缩率缺少对照条件">
        <h4>尺寸与收缩率缺少对照条件</h4>
        <dl>
          <dt>{ribWidth.label}</dt><dd>{ribWidth.value}</dd>
          <dt>材料成型收缩率</dt><dd>{shrinkage.value}</dd>
        </dl>
        <p>需补允许收缩率，或用模具与制件尺寸、流动方向和成型条件建立对照。</p>
      </section>}
      {report.missingRequirements.length > 0 && <section aria-label="待补产品要求">
        <h4>按这些维度选材时，待补产品要求</h4>
        <ul>{report.missingRequirements.map(item => <li key={item.key}><strong>{item.label}</strong><div>{item.requirement}</div></li>)}</ul>
      </section>}
      <details>
        <summary>本次读取的 Excel 参数和物性表数值</summary>
        <h4>{productName} Excel 参数</h4>
        <dl>{report.productMeasurements.map(item => <div className="relationship-attribute-evidence__condition" key={item.key}>
          <dt>{item.label}</dt><dd>{item.value}</dd>
        </div>)}</dl>
        <h4>物性表典型值</h4>
        <dl>{report.materialEvidence.map(item => <div className="relationship-attribute-evidence__condition" key={item.key}>
          <dt>{item.label}</dt><dd>{item.value}
            <small>{report.metricChecks.find(check => check.key === item.key)?.reason}</small>
          </dd>
        </div>)}</dl>
      </details>
    </>}
  </section>;
}
