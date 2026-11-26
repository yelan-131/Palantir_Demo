import type { AttributeDiscoveryComparison, AttributeDiscoveryEvidence } from './relationshipAttributeDiscovery';
import { relationshipNodeLabel } from './relationshipCardDetails';
import type { RelationshipNode } from './relationshipGraph';

const comparisonRules: Record<AttributeDiscoveryEvidence['rule'], string> = {
  'interval-overlap': '区间重叠率 = 交集长度 ÷ 并集长度',
  'numeric-equality': '换算后数值一致',
  'point-in-interval': '数值落在区间内',
  'category-equality': '规范化后类别值一致',
  'record-reference': '字段含义相符，引用值与对象标识一致',
};

const percent = (score: number) => `${Math.round(score * 1000) / 10}%`;
const rangeLabel = ([min, max]: readonly [number, number]) => `[${min}, ${max}]`;

export default function RelationshipAttributeEvidence({ comparison, source, target }: {
  comparison: AttributeDiscoveryComparison;
  source: RelationshipNode;
  target: RelationshipNode;
}) {
  const strengthLabel = comparison.evidence[0]?.rule === 'record-reference' ? '引用一致度' : '关系强度';
  return <div className="relationship-attribute-evidence">
    <dl aria-label={strengthLabel}>
      <dt>{strengthLabel}</dt><dd><strong>{percent(comparison.strength)}</strong></dd>
      <dt>匹配项</dt><dd>{comparison.matchingCount} / {comparison.comparedCount} 项可比属性</dd>
    </dl>
    {!!comparison.matchedContext?.length && <dl aria-label="相同的比较条件">
      {comparison.matchedContext.map(condition => <div className="relationship-attribute-evidence__condition"
        key={JSON.stringify([condition.sourceLabel, condition.targetLabel])}>
        <dt>{condition.sourceLabel === condition.targetLabel ? condition.sourceLabel : `${condition.sourceLabel} / ${condition.targetLabel}`}</dt>
        <dd>{condition.sourceValue}</dd>
      </div>)}
    </dl>}
    <ul aria-label="属性匹配依据">
      {comparison.evidence.map(evidence => <li key={JSON.stringify([evidence.sourceCode, evidence.targetCode])}>
        <div className="relationship-attribute-evidence__heading">
          <strong>{evidence.dimension}</strong><span>{percent(evidence.score)}</span>
        </div>
        <dl>
          <dt title={evidence.sourceLabel}>{relationshipNodeLabel(source)}{!evidence.sourceFields?.length && ` · ${evidence.sourceLabel}`}</dt><dd>{evidence.sourceValue}</dd>
          <dt title={evidence.targetLabel}>{relationshipNodeLabel(target)}{!evidence.targetFields?.length && ` · ${evidence.targetLabel}`}</dt><dd>{evidence.targetValue}</dd>
          {evidence.unit && <><dt>比较单位</dt><dd>{evidence.unit}</dd></>}
          {evidence.unit && evidence.sourceRange && evidence.targetRange && <>
            <dt>换算后</dt><dd>{rangeLabel(evidence.sourceRange)} / {rangeLabel(evidence.targetRange)}</dd>
          </>}
          {evidence.overlap && <><dt>交集</dt><dd>{rangeLabel(evidence.overlap)}</dd></>}
          {evidence.union && <><dt>并集范围</dt><dd>{rangeLabel(evidence.union)}</dd></>}
        </dl>
        <p>{comparisonRules[evidence.rule]}</p>
        {(evidence.sourceFields?.length || evidence.targetFields?.length) ? <details>
          <summary>查看原始字段</summary>
          {([{ node: source, fields: evidence.sourceFields }, { node: target, fields: evidence.targetFields }]).map(({ node, fields }) =>
            fields?.length ? <div key={node.id}>
              <p>{relationshipNodeLabel(node)}</p>
              <dl>{fields.map(field => <div className="relationship-attribute-evidence__condition" key={field.code}>
                <dt title={field.code}>{field.label}</dt><dd>{field.value}</dd>
              </div>)}</dl>
            </div> : null)}
        </details> : null}
      </li>)}
    </ul>
    <p className="relationship-attribute-evidence__source">
      记录来源 {source.typeName} · {source.key} / {target.key}
    </p>
  </div>;
}
