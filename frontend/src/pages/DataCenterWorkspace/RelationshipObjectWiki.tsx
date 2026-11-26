import { CloseOutlined, PlusOutlined } from '@/components/Icon/ant';
import { Button, Dropdown, Input, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import KnowledgeReader from '../../components/KnowledgeReader';
import {
  readObjectRecord, relationshipRecordMetadataLimits,
  type ObjectPropertySource, type ObjectRecordDetail, type RelationshipRecordMetadata, type RuntimeObjectType,
} from '../../services/objectRuntime';
import { formatServerDateTime } from '../../utils/dateTime';
import { createUuid } from '../../utils/uuid';
import RelationshipAttachmentImage, {
  RelationshipPdfAttachment, relationshipAttachmentImages, relationshipPdfAttachments, valveSectionDrawingView,
} from './RelationshipAttachmentImages';
import type { ManufacturingMatchRecord } from './manufacturingMatch';
import type { RelationshipNode } from './relationshipGraph';
import type { RelationshipNeighbor } from './relationshipSimilarityScene';
import { RelationshipMaterialTrialMarkdown } from './RelationshipTrialEvidence';
import type { MaterialTrial } from './relationshipTrialComparison';
import { relationshipMatchStatus, relationshipNodeLabel, relationshipPropertyLabel, type RelationshipCardMatch } from './relationshipCardDetails';
import {
  RelationshipMarkdownInput, RelationshipObjectClearField, RelationshipObjectEditField, RelationshipObjectEditorForm,
  type RelationshipObjectEditSnapshot,
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
    direction: 'incoming' | 'outgoing' | 'peer';
  }[];
  onOpenRelated?: (id: string) => void;
  onSelectRelationship?: (id: string) => void;
  referenceRecords?: readonly RelationshipNode[];
  comparisons?: readonly RelationshipNeighbor[];
  trials?: readonly ManufacturingMatchRecord[];
  materialTrials?: readonly MaterialTrial[];
  valveDurability?: ReactNode;
  selectedTrialKey?: string;
  matches?: readonly RelationshipCardMatch[];
  editSnapshot?: RelationshipObjectEditSnapshot;
  onSubmitEdit?: (data: Record<string, unknown>, expectedValues: Record<string, unknown>) => void;
  recordMetadataDraft?: RelationshipRecordMetadata;
  onRecordMetadataChange?: (metadata: RelationshipRecordMetadata) => void;
  markdownImportTarget?: HTMLElement | null;
  onMarkdownImportingChange?: (importing: boolean) => void;
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

function markdownDocument(source: string) {
  const header = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m);
  return header?.index === 0
    ? { attributes: header[1].trimEnd(), body: source.slice(header[0].length) }
    : { attributes: '', body: source };
}

function wikiSections(markdown: string, renderEmbed: (target: string) => ReactNode) {
  const sections: { source: string; embed?: ReactNode }[] = [];
  let lines: string[] = [];
  let fence = '';
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (marker && !fence) fence = marker;
    else if (marker && marker.startsWith(fence) && line.trim() === marker) fence = '';
    const target = !fence ? line.trim().match(/^!\[\[([^\]]+)\]\]$/)?.[1] : undefined;
    const embed = target && renderEmbed(target);
    if (embed) {
      sections.push({ source: lines.join('\n'), embed });
      lines = [];
    } else {
      lines.push(line);
    }
  }
  return [...sections, { source: lines.join('\n') }];
}

export function RelationshipWikiBody({
  markdown, trials = [], selectedTrialKey, showTrialSection = false, renderReference, renderEmbed,
}: {
  markdown: string;
  trials?: readonly ManufacturingMatchRecord[];
  selectedTrialKey?: string;
  showTrialSection?: boolean;
  renderReference?: (target: string) => ReactNode;
  renderEmbed?: (target: string) => ReactNode;
}) {
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
  const document = markdownDocument(markdown);
  const sections = wikiSections(document.body, target => target === '关联老化试验' ? trialSection : renderEmbed?.(target));
  return <div className="relationship-object-wiki__markdown">
    {document.attributes && <details className="relationship-object-wiki__file-properties">
      <summary>文件属性</summary><pre>{document.attributes}</pre>
    </details>}
    {sections.map(({ source, embed }, index) => <div key={index}>
      {source.trim() && <KnowledgeReader source={source} renderReference={renderReference} />}
      {embed}
    </div>)}
    {showTrialSection && sections.length === 1 && <section aria-label="老化试验记录">
      <Typography.Text strong>老化试验记录</Typography.Text>
      {trialSection}
    </section>}
  </div>;
}

export default function RelationshipObjectWiki({
  node, model, related = [], onOpenRelated, onSelectRelationship, referenceRecords = [], comparisons = [],
  trials, materialTrials, valveDurability, selectedTrialKey, matches = [], editSnapshot, onSubmitEdit, recordMetadataDraft, onRecordMetadataChange,
  markdownImportTarget, onMarkdownImportingChange, saving,
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
  const editFields = new Map(editSnapshot?.fields.map(field => [field.code, field]));
  const hiddenCodes = new Set(recordMetadata?.hidden_property_codes?.filter(code => !editingMetadata || !editFields.has(code)));
  recordMetadataDraft?.hidden_property_codes?.forEach(code => hiddenCodes.add(code));
  const properties = new Map(Object.entries(values));
  editFields.forEach(({ code }) => {
    if (!properties.has(code)) properties.set(code, editSnapshot?.values[code]);
  });
  properties.delete('wiki_markdown');
  const visibleProperties = [...properties].filter(([code]) => !hiddenCodes.has(code));
  const restorableProperties = [...properties.keys()].filter(code => hiddenCodes.has(code) && editFields.has(code));
  const masked = detail?.masked_fields ?? node.maskedFields;
  const markdown = typeof values.wiki_markdown === 'string' && !masked?.includes('wiki_markdown')
    ? values.wiki_markdown : recordMetadata?.note_markdown ?? '';
  const markdownField = editFields.get('wiki_markdown');
  const editNote = editingMetadata && editSnapshot?.can_edit_note_markdown;
  const tags = (editingMetadata ? recordMetadataDraft.tags : recordMetadata?.tags) ?? [];
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
    const images = masked?.includes(code) ? [] : relationshipAttachmentImages(value)
      .map(file => ({ file, drawingView: valveSectionDrawingView(key, code, file.id) }));
    const pdfs = masked?.includes(code) ? [] : relationshipPdfAttachments(value);
    const origins = mappedSourceLabels(sources?.[code]);
    const defaultLabel = code === 'wiki_markdown' ? 'Markdown 正文' : relationshipPropertyLabel(code, model);
    const drawingClass = images.some(item => item.drawingView) ? ' relationship-object-wiki__property--drawing' : '';
    return <div key={code} className={`relationship-object-wiki__property relationship-object-wiki__property--bound${drawingClass}`}>
      <dt>{propertyName(code, defaultLabel, Boolean(field))}</dt>
      <dd className="relationship-object-wiki__property-value">
        <div className="relationship-object-wiki__value-slot">
          {images.length > 0 || pdfs.length > 0 ? <div className="relationship-object-wiki__value">
            {images.map(({ file, drawingView }) => <RelationshipAttachmentImage key={`${typeId}:${key}:${code}:${file.id}`}
              objectId={typeId} recordKey={key} property={code} file={file} drawingView={drawingView} />)}
            {pdfs.map(file => <RelationshipPdfAttachment key={file.id} objectId={typeId} recordKey={key} property={code} file={file} />)}
          </div> : <span className="relationship-object-wiki__value" aria-hidden={field ? true : undefined}>{formattedValue(value)}</span>}
          {field && <RelationshipObjectEditField field={field} disabled={saving} />}
        </div>
        {field && <div className="relationship-object-wiki__property-controls">
          {!field.required && <RelationshipObjectClearField field={field} disabled={saving} />}
          {editingMetadata && <Button type="text" size="small" htmlType="button" icon={<CloseOutlined />}
            aria-label={`从此笔记移除${defaultLabel}`} title={`从此笔记移除${defaultLabel}`}
            disabled={saving} onClick={() => setPropertyHidden(code, true)} />}
        </div>}
        {origins.length > 0 && <div className="relationship-object-wiki__origin">来源映射　{origins.join('、')}</div>}
      </dd>
    </div>;
  }

  function updateCustomProperties(properties: RelationshipRecordMetadata['properties']) {
    if (recordMetadataDraft) onRecordMetadataChange?.({ ...recordMetadataDraft, properties });
  }

  function setPropertyHidden(code: string, hidden: boolean) {
    if (!editingMetadata) return;
    const current = recordMetadataDraft.hidden_property_codes ?? [];
    onRecordMetadataChange({
      ...recordMetadataDraft,
      hidden_property_codes: hidden ? [...new Set([...current, code])] : current.filter(item => item !== code),
    });
  }

  function addCustomProperty() {
    updateCustomProperties([...customProperties, { id: createUuid(), name: '', value: '' }]);
  }

  function findReference(target: string) {
    const matches = referenceRecords.filter(record => record.key === target || relationshipNodeLabel(record) === target);
    return matches.length === 1 ? matches[0] : undefined;
  }

  function noteLink(target: RelationshipNode, text: string) {
    return <Tooltip title={`${target.typeName} · ${target.key}`}>
      <Button type="link" size="small" htmlType="button" className="relationship-object-wiki__inline-link"
        disabled={Boolean(editSnapshot)} onClick={() => onOpenRelated?.(target.id)}>{text}</Button>
    </Tooltip>;
  }

  function renderReference(source: string) {
    const [target, alias] = source.split('|', 2);
    const match = findReference(target.trim());
    return match ? noteLink(match, alias?.trim() || relationshipNodeLabel(match)) : undefined;
  }

  function renderEmbed(source: string) {
    if (source === '材料耐介质试验') return <RelationshipMaterialTrialMarkdown trials={materialTrials ?? []} />;
    const [target, property] = source.split('#', 2);
    const match = property && findReference(target.trim());
    if (!match) return undefined;
    const code = property === '结论' && !Object.prototype.hasOwnProperty.call(match.values, property) ? 'finding' : property;
    if (match.maskedFields?.includes(code) || !Object.prototype.hasOwnProperty.call(match.values, code)) return undefined;
    return <blockquote className="relationship-object-wiki__embed">
      {noteLink(match, relationshipNodeLabel(match))}
      <p>{formattedValue(match.values[code])}</p>
    </blockquote>;
  }

  return <article className="relationship-object-wiki" aria-label="对象卡片">
    <RelationshipObjectEditorForm snapshot={editSnapshot} onSubmit={onSubmitEdit} disabled={saving}>
      <header className="relationship-object-wiki__header">
        <h2 className="relationship-object-wiki__title" title={label}>{label}</h2>
        <div className="relationship-object-wiki__metadata">
          {label !== node.key && <Typography.Text code>{node.key}</Typography.Text>}
          <span className="relationship-object-wiki__type">{node.typeName}</span>
          {bindingForm && <Typography.Text type="secondary">记录来源　{bindingForm.name}</Typography.Text>}
          {updatedAt && <Typography.Text type="secondary">记录更新　{formatServerDateTime(updatedAt, '—')}</Typography.Text>}
          {!bindingForm && needsDetail && loaded?.node !== node && <Typography.Text type="secondary">正在读取记录来源</Typography.Text>}
        </div>
        <RelationshipRecordTags key={editingMetadata ? 'edit' : 'read'} tags={tags} disabled={saving}
          onChange={editingMetadata ? tags => onRecordMetadataChange({ ...recordMetadataDraft, tags }) : undefined} />
      </header>

      {valveDurability}

      <section className="relationship-object-wiki__section relationship-object-wiki__section--properties" aria-label="对象属性">
        {(visibleProperties.length > 0 || customProperties.length > 0) && <dl className="relationship-object-wiki__properties">
          {visibleProperties.map(([code, value]) => propertyRow(code, value))}
          {customProperties.map(property => <RelationshipCustomPropertyRow key={`custom:${property.id}`} property={property} disabled={saving}
            original={originalCustomProperties.find(item => item.id === property.id)}
            onChange={editingMetadata ? next => updateCustomProperties(customProperties.map(item => item.id === next.id ? next : item)) : undefined}
            onRemove={editingMetadata ? () => updateCustomProperties(customProperties.filter(item => item.id !== property.id)) : undefined} />)}
        </dl>}
        {editingMetadata && <div className="relationship-object-wiki__property-actions">
          {restorableProperties.length ? <Dropdown trigger={['click']} disabled={saving} menu={{
            items: [
              ...restorableProperties.map(code => ({ key: `property:${code}`, label: displayedPropertyName(code) })),
              { key: 'custom', label: '自定义属性', disabled: customProperties.length >= relationshipRecordMetadataLimits.properties },
            ],
            onClick: ({ key }) => key === 'custom' ? addCustomProperty() : setPropertyHidden(key.slice('property:'.length), false),
          }}>
            <Button type="link" htmlType="button" size="small" icon={<PlusOutlined />}>添加属性</Button>
          </Dropdown> : <Button type="link" htmlType="button" size="small" icon={<PlusOutlined />}
            disabled={saving || customProperties.length >= relationshipRecordMetadataLimits.properties} onClick={addCustomProperty}>添加属性</Button>}
        </div>}
      </section>

      {markdownField || editNote || markdown.trim() ? <div className="relationship-object-wiki__document">
        {markdownField ? <RelationshipObjectEditField field={markdownField} disabled={saving}
          markdownImportTarget={markdownImportTarget} onMarkdownImportingChange={onMarkdownImportingChange} />
          : editNote ? <RelationshipMarkdownInput value={recordMetadataDraft.note_markdown} disabled={saving}
            importTarget={markdownImportTarget} onImportingChange={onMarkdownImportingChange}
            maxLength={relationshipRecordMetadataLimits.markdownLength}
            onChange={note_markdown => onRecordMetadataChange({ ...recordMetadataDraft, note_markdown })} />
          : <RelationshipWikiBody markdown={markdown} trials={trials} selectedTrialKey={selectedTrialKey}
            renderReference={renderReference} renderEmbed={renderEmbed} />}
      </div> : null}

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
      <section className="relationship-object-wiki__section" aria-label="当前图中的关联对象">
        <h3>关联对象</h3>
        {related.length > 0 ? <ul className="relationship-object-wiki__relations">
          {related.map(({ node: neighbor, label, edgeId, direction, kind }) => <li key={edgeId}>
            <div className="relationship-object-wiki__relation-heading">
              {onOpenRelated ? noteLink(neighbor, relationshipNodeLabel(neighbor)) : <strong>{relationshipNodeLabel(neighbor)}</strong>}
              {relationshipNodeLabel(neighbor) !== neighbor.key && <Typography.Text code>{neighbor.key}</Typography.Text>}
            </div>
            <span>{direction === 'peer' ? '' : direction === 'outgoing' ? '出向 · ' : '入向 · '}{label} · {neighbor.typeName}</span>
            {onSelectRelationship && <Button type="link" size="small" onClick={() => onSelectRelationship(edgeId)}
              disabled={Boolean(editSnapshot)} aria-label={`查看${label}依据 · ${neighbor.key}`}>
              {kind === 'candidate' ? '查看候选依据' : '查看匹配依据'}
            </Button>}
          </li>)}
        </ul> : <Typography.Text type="secondary">图中暂无连线</Typography.Text>}
      </section>
      {model?.description && <details className="relationship-object-wiki__type-description">
        <summary>对象类型说明</summary>
        <p>{model.description}</p>
      </details>}
    </RelationshipObjectEditorForm>
  </article>;
}
