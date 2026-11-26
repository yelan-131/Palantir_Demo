import { Button, Tag, Typography } from 'antd';
import { RelationshipPdfAttachment, relationshipPdfAttachments } from './RelationshipAttachmentImages';
import type { RelationshipNode } from './relationshipGraph';
import type { RelationshipValveDurabilityEvidence } from './relationshipValveDurabilityScene';

const verdicts = {
  pending: { label: '待补数据', color: 'gold' },
  pass: { label: '满足要求', color: 'green' },
  fail: { label: '低于要求', color: 'red' },
} as const;

export default function RelationshipValveDurabilityEvidencePanel({ entries, nodesById, onOpenRequirement }: {
  entries: readonly RelationshipValveDurabilityEvidence[];
  nodesById: ReadonlyMap<string, RelationshipNode>;
  onOpenRequirement?: (id: string) => void;
}) {
  return <>{entries.map(({ result, requirementNodeId, materialNodeId }) => {
    const { requirement, materialGrade, trial, checks, status, reasons } = result;
    const { medium, temperatureC, durationH, conditionBasis } = requirement;
    const condition = [medium ?? '—', temperatureC === undefined ? '—' : `${temperatureC} ℃`,
      durationH === undefined ? '—' : `${durationH} 小时`].join(' · ');
    const verdict = verdicts[status];
    const sharedSource = trial && trial.sourceUrl === requirement.sourceUrl;
    const material = materialNodeId ? nodesById.get(materialNodeId) : undefined;
    const property = 'material_datasheet';
    const datasheets = material?.maskedFields?.includes(property) ? [] : relationshipPdfAttachments(material?.values[property]);
    return <section className="relationship-explorer-trial-evidence relationship-valve-durability"
      key={JSON.stringify([requirement.key, materialGrade])} aria-label="冷冻液耐久对比">
      <header className="relationship-valve-durability__header">
        <h3>冷冻液耐久对比</h3><Tag color={verdict.color}>{verdict.label}</Tag>
      </header>
      <dl aria-label="耐久工况">
        <dt>{conditionBasis === 'reference' ? '参考工况' : '产品工况'}</dt><dd>{condition}</dd>
        <dt>材料牌号</dt><dd>{materialGrade || '—'}</dd>
      </dl>
      <div className="relationship-object-wiki__trials">
        <table aria-label="老化后强度对比">
          <thead><tr><th scope="col">指标</th><th scope="col">产品下限<br />（MPa）</th><th scope="col">材料试验后<br />（MPa）</th></tr></thead>
          <tbody>{checks.map(check => <tr key={check.key}>
            <th scope="row">{check.label}</th>
            <td>{check.minimumMpa ?? '—'}</td><td>{check.actualMpa ?? '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {reasons.map(reason => <p key={reason}>{reason}</p>)}
      <footer className="relationship-valve-durability__sources">
        {material && datasheets.map(file => <RelationshipPdfAttachment key={file.id}
          objectId={material.typeId} recordKey={material.key} property={property} file={file} label="下载材料物性表 PDF" />)}
        {requirement.sourceUrl && <a href={requirement.sourceUrl} target="_blank" rel="noopener noreferrer">
          {sharedSource ? '冷冻液试验来源' : requirement.sourceName ?? '要求来源'}
        </a>}
        {requirement.sourceName && !requirement.sourceUrl && <Typography.Text type="secondary">{requirement.sourceName}</Typography.Text>}
        {trial && !sharedSource && <a href={trial.sourceUrl} target="_blank" rel="noopener noreferrer">{trial.sourceName}</a>}
        {requirementNodeId && onOpenRequirement && <Button type="link" size="small"
          onClick={() => onOpenRequirement(requirementNodeId)}>查看要求记录</Button>}
      </footer>
    </section>;
  })}</>;
}
