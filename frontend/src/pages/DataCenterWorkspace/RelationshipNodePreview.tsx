import { Tag, Typography } from 'antd';
import { useLayoutEffect, useRef, useState, type PointerEventHandler, type RefObject } from 'react';
import type { RuntimeObjectType } from '../../services/objectRuntime';
import type { ManufacturingMatchResult } from './manufacturingMatch';
import type { RelationshipNode } from './relationshipGraph';
import type { RelationshipNeighbor } from './relationshipSimilarityScene';

export type RelationshipCardMatch = {
  status: ManufacturingMatchResult['status'];
  checks: readonly ManufacturingMatchResult['checks'][number][];
  context: string;
};

const propertyLabels: Record<string, string> = {
  product_code: '产品编号', product_name: '产品名称', product_version: '规格版本', grade_code: '牌号编号', grade_name: '牌号名称',
  grade_family: '材料类别', process_version_code: '工艺版本编号', process_name: '规程名称', version_label: '版本',
  fit_code: '方案编号', fit_status: '方案状态', conditions: '适用条件', operation: '工序', aging_method: '试验类型',
  aging_temperature: '老化温度（℃）', aging_hours: '老化时长（h）', strength_min: '强度下限（MPa）',
  forming_temperature_min: '成型温度下限（℃）', forming_temperature_max: '成型温度上限（℃）',
  forming_temperature: '成型设定温度（℃）', tensile_strength: '抗拉强度（MPa）', specimen_code: '试样编号',
  production_line: '产线', planned_quantity: '计划数量', completed_quantity: '完成数量', work_order_id: '工单号', defect_id: '缺陷编号',
};

const previewProperties = [
  'product_version', 'grade_family', 'version_label', 'operation', 'strength_min', 'forming_temperature',
  'forming_temperature_min', 'forming_temperature_max', 'aging_method', 'aging_temperature', 'aging_hours', 'tensile_strength', 'fit_status',
];

export function relationshipPropertyLabel(code: string, model?: RuntimeObjectType) {
  const field = model?.fields.find(item => (item.code || item.name) === code);
  const label = field?.label || field?.name;
  return label && label !== code ? label : propertyLabels[code] || code;
}

export function relationshipValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function relationshipNodeLabel(node: RelationshipNode) {
  const label = [node.values.product_name, node.values.grade_name, node.values.process_name, node.values.name]
    .find(value => typeof value === 'string' && value.trim());
  return typeof label === 'string' ? label : node.key;
}

export const relationshipMatchStatus = {
  candidate: { label: '候选组合', color: 'green' }, pending: { label: '待验证', color: 'gold' }, rejected: { label: '未满足规则', color: 'red' },
};

export default function RelationshipNodePreview({ node, model, anchor, stage, links, matches, comparison, onPointerEnter, onPointerLeave }: {
  node: RelationshipNode;
  model?: RuntimeObjectType;
  anchor: { x: number; y: number };
  stage: RefObject<HTMLDivElement | null>;
  links: number;
  matches: readonly RelationshipCardMatch[];
  comparison?: RelationshipNeighbor;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight?: number }>();
  const available = Object.keys(node.values).filter(code => code !== 'wiki_markdown');
  const compared = comparison?.features.map(feature => feature.sourceCode) ?? [];
  const fields = [...new Set([...compared, ...previewProperties, ...available])].filter(code => available.includes(code)).slice(0, 4);
  const match = matches[0];
  const proof = match?.checks.find(check => check.status === 'fail') ?? match?.checks.find(check => check.status === 'pending')
    ?? match?.checks.find(check => check.code === 'strength') ?? match?.checks.find(check => check.code === 'product-temperature');
  const outcome = match && relationshipMatchStatus[match.status];

  useLayoutEffect(() => {
    const bounds = stage.current;
    const element = card.current;
    if (!bounds || !element) return;
    const place = () => {
      const margin = 8;
      const gap = 16;
      const width = element.offsetWidth;
      const height = element.scrollHeight + element.offsetHeight - element.clientHeight;
      const stageWidth = bounds.clientWidth;
      const stageHeight = bounds.clientHeight;
      const clamp = (value: number, maximum: number) => Math.max(margin, Math.min(value, maximum - margin));
      const right = stageWidth - anchor.x - gap - margin;
      const left = anchor.x - gap - margin;
      if (right >= width || left >= width) {
        setPosition({
          left: clamp(right >= width ? anchor.x + gap : anchor.x - width - gap, stageWidth - width),
          top: clamp(anchor.y - 24, stageHeight - height),
        });
        return;
      }

      const above = anchor.y - gap - margin;
      const below = stageHeight - anchor.y - gap - margin;
      const placeBelow = below >= height || (above < height && below >= above);
      const maxHeight = Math.max(0, Math.min(placeBelow ? below : above, stageHeight - margin * 2));
      const shownHeight = Math.min(height, maxHeight);
      setPosition({
        left: clamp(anchor.x - width / 2, stageWidth - width),
        top: clamp(placeBelow ? anchor.y + gap : anchor.y - gap - shownHeight, stageHeight - shownHeight),
        maxHeight,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(bounds);
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchor.x, anchor.y, stage, node.id]);

  return <div ref={card} role="tooltip" aria-label={`${node.key} 对象预览`} className="relationship-node-preview"
    onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}
    style={{ ...position, overflowY: position?.maxHeight === undefined ? undefined : 'auto', visibility: position ? 'visible' : 'hidden' }}>
    <header>
      <Typography.Text strong>{relationshipNodeLabel(node)}</Typography.Text>
      <Tag>{node.typeName}</Tag>
    </header>
    <Typography.Text type="secondary" className="relationship-node-preview__identity">{node.key} · {links} 条可见连线</Typography.Text>
    {fields.length > 0 && <dl>
      {fields.map(code => <div key={code}><dt>{relationshipPropertyLabel(code, model)}</dt><dd>{relationshipValue(node.values[code])}</dd></div>)}
    </dl>}
    {comparison && <div className="relationship-node-preview__evidence">
      <Typography.Text type="secondary">与 {comparison.node.key} 相似度 {Math.round(comparison.similarity * 100)}%</Typography.Text>
    </div>}
    {match && outcome && <div className="relationship-node-preview__evidence">
      <Tag color={outcome.color}>{outcome.label}</Tag>
      <Typography.Text type="secondary">{match.context}</Typography.Text>
      {proof && <p>{proof.explanation}</p>}
      {matches.length > 1 && <Typography.Text type="secondary">另有 {matches.length - 1} 个组合</Typography.Text>}
    </div>}
    {node.bindingForm && <Typography.Text type="secondary" className="relationship-node-preview__source">来源　{node.bindingForm.name}</Typography.Text>}
    <footer>点击节点查看完整卡片</footer>
  </div>;
}
