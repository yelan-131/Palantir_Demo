import { PlusOutlined } from '@/components/Icon/ant';
import { Button, Input, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import KnowledgeReader from '../../components/KnowledgeReader';
import {
  readObjectRecord, relationshipRecordMetadataLimits,
  type ObjectPropertySource, type ObjectRecordDetail, type RelationshipRecordMetadata, type RuntimeObjectType,
} from '../../services/objectRuntime';
import { formatServerDateTime } from '../../utils/dateTime';
import { createUuid } from '../../utils/uuid';
import type { ManufacturingMatchRecord } from './manufacturingMatch';
import type { RelationshipNode } from './relationshipGraph';
import type { RelationshipNeighbor } from './relationshipSimilarityScene';
import { relationshipMatchStatus, relationshipNodeLabel, relationshipPropertyLabel, type RelationshipCardMatch } from './RelationshipNodePreview';
import {
  RelationshipObjectClearField, RelationshipObjectEditField, RelationshipObjectEditorForm, type RelationshipObjectEditSnapshot,
} from './RelationshipObjectEditor';
import { RelationshipCustomPropertyRow, RelationshipRecordTags } from './RelationshipRecordMetadataFields';
import './relationshipObjectWiki.css';

export interface RelationshipObjectWikiProps {
  node: RelationshipNode;
  model?: RuntimeObjectType;
  related?: readonly {
    node: RelationshipNode;
    label: string;
    edgeId: string;
    kind?: 'candidate';
    direction: 'incoming' | 'outgoing';
  }[];
  onOpenRelated?: (id: string) => void;
  onSelectRelationship?: (id: string) => void;
  comparisons?: readonly RelationshipNeighbor[];
  trials?: readonly ManufacturingMatchRecord[];
  selectedTrialKey?: string;
  matches?: readonly RelationshipCardMatch[];
  editSnapshot?: RelationshipObjectEditSnapshot;
  onSubmitEdit?: (data: Record<string, unknown>, expectedValues: Record<string, unknown>) => void;
  recordMetadataDraft?: RelationshipRecordMetadata;
  onRecordMetadataChange?: (metadata: RelationshipRecordMetadata) => void;
  saving?: boolean;
}

function formattedValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function mappedSourceLabels(source?: ObjectPropertySource | ObjectPropertySource[]) {
  const sources = Array.isArray(source) ? source : source ? [source] : [];
  return sources.map(item => [item.source_name, item.source_entity, item.source_field].filter(Boolean).join(' / ')).filter(Boolean);
}

function BoundPropertyNameInput({ initialValue, defaultLabel, onChange, disabled }: {
  initialValue: string;
  defaultLabel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  return <Input aria-label={`属性名称 · ${defaultLabel}`} placeholder={defaultLabel}
    value={value} maxLength={relationshipRecordMetadataLimits.nameLength} disabled={disabled}
    onChange={event => {
      const next = event.target.value;
      setValue(next);
      onChange(next);
    }} />;
}

function wikiSections(markdown: string) {
  const sections: string[] = [];
  let lines: string[] = [];
  let fence = '';
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (marker && !fence) fence = marker;
    else if (marker && marker.startsWith(fence) && line.trim() === marker) fence = '';
    if (!fence && line.trim() === '![[关联老化试验]]') {
      sections.push(lines.join('\n'));
      lines = [];
    } else {
      lines.push(line);
    }
  }
  return [...sections, lines.join('\n')];
}

export function RelationshipWikiBody({
  markdown, trials = [], selectedTrialKey, showTrialSection = false,
}: { markdown: string; trials?: readonly ManufacturingMatchRecord[]; selectedTrialKey?: string; showTrialSection?: boolean }) {
  const sections = wikiSections(markdown);
  const trialSection = trials.length ? <div className="relationship-object-wiki__trials">
        <table aria-label="关联老化试验">
          <thead><tr>
            <th scope="col">试验记录</th><th scope="col">试验类型</th><th scope="col">温度（℃）</th>
            <th scope="col">时长（h）</th><th scope="col">抗拉强度（MPa）</th><th scope="col">试样</th>
          </tr></thead>
          <tbody>{trials.map((trial, position) => {
            const { trial_code, aging_method, aging_temperature, aging_hours, tensile_strength, specimen_code } = trial.values;
            const selected = trial.key === selectedTrialKey;
            return <tr key={JSON.stringify([trial.key, position])} className={selected ? 'relationship-object-wiki__matched-trial' : undefined}>
              <th scope="row">{formattedValue(trial_code ?? trial.key)}{selected && <Tag>规则取用</Tag>}</th>
              {[aging_method, aging_temperature, aging_hours, tensile_strength, specimen_code].map((value, index) =>
                <td key={index}>{formattedValue(value)}</td>)}
            </tr>;
          })}</tbody>
        </table>
      </div> : <Typography.Text type="secondary">暂无可查看的关联老化试验</Typography.Text>;
  return <div className="relationship-object-wiki__markdown">
    {sections.map((source, index) => <div key={index}>
      {source.trim() && <KnowledgeReader source={source} />}
      {index < sections.length - 1 && trialSection}
    </div>)}
    {showTrialSection && sections.length === 1 && <section aria-label="老化试验记录">
      <Typography.Text strong>老化试验记录</Typography.Text>
      {trialSection}
    </section>}
  </div>;
}

export default function RelationshipObjectWiki({
  node, model, related = [], onOpenRelated, onSelectRelationship, comparisons = [],
  trials, selectedTrialKey, matches = [], editSnapshot, onSubmitEdit, recordMetadataDraft, onRecordMetadataChange, saving,
}: RelationshipObjectWikiProps) {
  const [loaded, setLoaded] = useState<{ node: RelationshipNode; record?: ObjectRecordDetail }>();
  const needsDetail = !node.bindingForm || !node.recordMetadata;
  const { key, typeId } = node;
  const detail = needsDetail && loaded?.node === node ? loaded.record : undefined;
  const values = detail?.values ?? node.values;
  const bindingForm = detail?.binding_form ?? node.bindingForm;
  const sources = detail?.sources ?? node.sources;
  const updatedAt = detail?.updated_at ?? node.updatedAt;
  const recordMetadata = detail?.record_metadata ?? node.recordMetadata;
  const originalCustomProperties = recordMetadata?.properties ?? [];
  const customProperties = recordMetadataDraft?.properties ?? originalCustomProperties;
  const editingMetadata = recordMetadataDraft !== undefined && onRecordMetadataChange !== undefined;
  const markdown = typeof values.wiki_markdown === 'string' ? values.wiki_markdown.trim() : '';
  const markdownOrigins = mappedSourceLabels(sources?.wiki_markdown);
  const properties = Object.entries(values).filter(([code]) => code !== 'wiki_markdown' || !markdown);
  const editFields = new Map(editSnapshot?.fields.map(field => [field.code, field]));
  const extraFields = editSnapshot?.fields.filter(field => !Object.prototype.hasOwnProperty.call(values, field.code)) ?? [];
  const markdownField = markdown ? editFields.get('wiki_markdown') : undefined;
  const label = relationshipNodeLabel(node);

  useEffect(() => {
    if (!needsDetail) return;
    const controller = new AbortController();
    readObjectRecord(typeId, key, controller.signal).then(response => {
      if (!controller.signal.aborted) setLoaded({ node, record: response.data.data });
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded({ node });
    });
    return () => controller.abort();
  }, [key, needsDetail, node, typeId]);

  function displayedPropertyName(code: string, defaultLabel = relationshipPropertyLabel(code, model)) {
    const saved = recordMetadata?.property_labels?.[code];
    return typeof saved === 'string' ? saved : defaultLabel;
  }

  function propertyName(code: string, defaultLabel: string, editable: boolean) {
    const editing = editable && editingMetadata;
    const draftLabel = recordMetadataDraft?.property_labels?.[code];
    return <span className="relationship-object-wiki__property-name-slot">
      <span aria-hidden={editing ? true : undefined}>{displayedPropertyName(code, defaultLabel)}</span>
      {editing && <BoundPropertyNameInput initialValue={typeof draftLabel === 'string' ? draftLabel : defaultLabel}
        defaultLabel={defaultLabel} disabled={saving} onChange={value => {
          const { [code]: previous, ...otherLabels } = recordMetadataDraft.property_labels ?? {};
          const trimmed = value.trim();
          const override = trimmed && trimmed !== defaultLabel ? trimmed : undefined;
          if (previous === override) return;
          const propertyLabels = override ? { ...otherLabels, [code]: override } : otherLabels;
          onRecordMetadataChange({ ...recordMetadataDraft, property_labels: propertyLabels });
        }} />}
    </span>;
  }

  function propertyRow(code: string, value: unknown) {
    const field = editFields.get(code);
    const origins = mappedSourceLabels(sources?.[code]);
    const defaultLabel = code === 'wiki_markdown' ? 'Markdown 正文' : relationshipPropertyLabel(code, model);
    return <div key={code} className="relationship-object-wiki__property relationship-object-wiki__property--bound">
      <dt>{propertyName(code, defaultLabel, Boolean(field))}</dt>
      <dd className="relationship-object-wiki__property-value">
        <div className="relationship-object-wiki__value-slot">
          <span className="relationship-object-wiki__value" aria-hidden={field ? true : undefined}>{formattedValue(value)}</span>
          {field && <RelationshipObjectEditField field={field} disabled={saving} />}
        </div>
        {field && !field.required && <RelationshipObjectClearField field={field} disabled={saving} />}
        {origins.length > 0 && <div className="relationship-object-wiki__origin">来源映射　{origins.join('、')}</div>}
      </dd>
    </div>;
  }

  function updateCustomProperties(properties: RelationshipRecordMetadata['properties']) {
    if (recordMetadataDraft) onRecordMetadataChange?.({ ...recordMetadataDraft, properties });
  }

  return <article className="relationship-object-wiki" aria-label="对象卡片">
    <RelationshipObjectEditorForm snapshot={editSnapshot} onSubmit={onSubmitEdit} disabled={saving}>
      <header className="relationship-object-wiki__header">
        <h2 className="relationship-object-wiki__title" title={label}>{label}</h2>
        <RelationshipRecordTags defaultTag={node.typeName} tags={recordMetadata?.tags} draft={recordMetadataDraft?.tags} disabled={saving}
          onChange={editingMetadata ? tags => onRecordMetadataChange({ ...recordMetadataDraft, tags }) : undefined} />
        <div className="relationship-object-wiki__metadata">
          {label !== node.key && <Typography.Text code>{node.key}</Typography.Text>}
          {bindingForm && <Typography.Text type="secondary">记录来源　{bindingForm.name}</Typography.Text>}
          {updatedAt && <Typography.Text type="secondary">记录更新　{formatServerDateTime(updatedAt, '—')}</Typography.Text>}
          {!bindingForm && needsDetail && loaded?.node !== node && <Typography.Text type="secondary">正在读取记录来源</Typography.Text>}
        </div>
      </header>

      <section className="relationship-object-wiki__section relationship-object-wiki__section--properties" aria-label="对象属性">
        {properties.length || customProperties.length ? <dl className="relationship-object-wiki__properties">
          {properties.map(([code, value]) => propertyRow(code, value))}
          {customProperties.map(property => <RelationshipCustomPropertyRow key={`custom:${property.id}`} property={property} disabled={saving}
            original={originalCustomProperties.find(item => item.id === property.id)}
            onChange={editingMetadata ? next => updateCustomProperties(customProperties.map(item => item.id === next.id ? next : item)) : undefined}
            onRemove={editingMetadata ? () => updateCustomProperties(customProperties.filter(item => item.id !== property.id)) : undefined} />)}
        </dl> : <Typography.Text type="secondary">暂无可查看的属性</Typography.Text>}
        {(recordMetadata || editingMetadata) && <div className="relationship-object-wiki__property-actions">
          {editingMetadata && <Button type="link" htmlType="button" size="small" icon={<PlusOutlined />}
            disabled={saving || customProperties.length >= relationshipRecordMetadataLimits.properties}
            onClick={() => updateCustomProperties([...customProperties, { id: createUuid(), name: '', value: '' }])}>添加属性</Button>}
        </div>}
      </section>

      {comparisons.length > 0 && <section className="relationship-object-wiki__section" aria-label="属性对比">
        <h3>属性对比</h3>
        {comparisons.map(comparison => <div className="relationship-object-wiki__match" key={comparison.node.id}>
          <div className="relationship-similarity-heading">
            {onOpenRelated ? <Button type="link" size="small" onClick={() => onOpenRelated(comparison.node.id)}>{comparison.node.key}</Button> : <strong>{comparison.node.key}</strong>}
            <span>相似度 {Math.round(comparison.similarity * 100)}%</span>
          </div>
          {comparison.coverage < 0.995 && <Typography.Text type="secondary">比较覆盖 {Math.round(comparison.coverage * 100)}%</Typography.Text>}
          <dl className="relationship-similarity-values">
            {comparison.features.map(feature => <div key={feature.dimension}>
              <dt>{displayedPropertyName(feature.sourceCode)}</dt>
              <dd>{formattedValue(feature.sourceValue)} / {formattedValue(feature.targetValue)}</dd>
            </div>)}
          </dl>
        </div>)}
      </section>}
      {markdown && <section className="relationship-object-wiki__section relationship-object-wiki__section--markdown" aria-label="Markdown 正文">
        <h3>{propertyName('wiki_markdown', 'Markdown 正文', Boolean(markdownField))}</h3>
        {markdownField && !markdownField.required && <div className="relationship-object-wiki__markdown-clear">
          <RelationshipObjectClearField field={markdownField} disabled={saving} />
        </div>}
        {markdownOrigins.length > 0 && <div className="relationship-object-wiki__origin">来源映射　{markdownOrigins.join('、')}</div>}
        <div className="relationship-object-wiki__markdown-slot">
          <div aria-hidden={markdownField ? true : undefined}>
            <RelationshipWikiBody markdown={markdown} trials={trials} selectedTrialKey={selectedTrialKey} />
          </div>
          {markdownField && <div className="relationship-object-wiki__markdown-editor">
            <RelationshipObjectEditField field={markdownField} disabled={saving} />
          </div>}
        </div>
      </section>}
      {matches.length > 0 && <section className="relationship-object-wiki__section" aria-label="匹配依据">
        <h3>匹配依据</h3>
        {matches.map(match => {
          const outcome = relationshipMatchStatus[match.status];
          return <div className="relationship-object-wiki__match" key={match.context}>
            <div><Typography.Text strong>{match.context} </Typography.Text><Tag color={outcome.color}>{outcome.label}</Tag></div>
            <ul>{match.checks.map(check => <li key={check.code}>
              <Typography.Text strong>{check.label}</Typography.Text>
              <p>{check.explanation}</p>
            </li>)}</ul>
          </div>;
        })}
      </section>}
      {model?.description && <section className="relationship-object-wiki__section" aria-label="对象类型说明">
        <h3>对象类型说明</h3>
        <p>{model.description}</p>
      </section>}
      <section className="relationship-object-wiki__section" aria-label="当前图中的关联对象">
        <h3>关联对象</h3>
        {related.length > 0 ? <ul className="relationship-object-wiki__relations">
          {related.map(({ node: neighbor, label, edgeId, direction, kind }) => <li key={edgeId}>
            {onOpenRelated ? <Button type="link" size="small" onClick={() => onOpenRelated(neighbor.id)}>{neighbor.key}</Button> : <strong>{neighbor.key}</strong>}
            <span>{direction === 'outgoing' ? '→' : '←'} {label} · {neighbor.typeName}</span>
            {onSelectRelationship && <Button type="link" size="small" onClick={() => onSelectRelationship(edgeId)}
              aria-label={`查看${label}依据 · ${neighbor.key}`}>{kind === 'candidate' ? '查看候选依据' : '查看匹配依据'}</Button>}
          </li>)}
        </ul> : <Typography.Text type="secondary">图中暂无连线</Typography.Text>}
      </section>
      {extraFields.length > 0 && <section className="relationship-object-wiki__section relationship-object-wiki__section--properties" aria-label="其他可编辑属性">
        <h3>其他可编辑属性</h3>
        <dl className="relationship-object-wiki__properties">
          {extraFields.map(field => propertyRow(field.code, editSnapshot?.values[field.code]))}
        </dl>
      </section>}
    </RelationshipObjectEditorForm>
  </article>;
}
