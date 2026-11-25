import { DeleteOutlined } from '@/components/Icon/ant';
import { Button, Input, Select, Tag, message } from 'antd';
import { relationshipRecordMetadataLimits, type RelationshipRecordMetadata } from '../../services/objectRuntime';

type CustomProperty = RelationshipRecordMetadata['properties'][number];

export function RelationshipRecordTags({ defaultTag, tags, draft, onChange, disabled }: {
  defaultTag: string;
  tags?: string[] | null;
  draft?: string[] | null;
  onChange?: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const defaults = defaultTag ? [defaultTag] : [];
  const displayed = tags ?? defaults;
  const selected = draft ?? defaults;
  const editing = draft !== undefined && onChange !== undefined;
  return <div className="relationship-object-wiki__tags">
    <span>标签</span>
    <div className="relationship-object-wiki__tag-slot">
      <div className="relationship-object-wiki__tag-list" aria-hidden={editing ? true : undefined}>
        {displayed.length ? displayed.map(tag => <Tag key={tag} title={tag}>{tag}</Tag>) : <span>—</span>}
      </div>
      {editing && <Select<string[]>
        aria-label="记录标签"
        mode="tags"
        size="small"
        allowClear
        value={selected}
        disabled={disabled}
        placeholder="添加标签"
        tokenSeparators={[',', '，']}
        maxTagCount="responsive"
        maxCount={relationshipRecordMetadataLimits.tags}
        options={[...new Set([...defaults, ...displayed, ...selected])].map(tag => ({ value: tag, label: tag }))}
        onChange={value => {
          const next = [...new Set(value.map(tag => tag.trim()).filter(Boolean))];
          if (next.some(tag => [...tag].length > relationshipRecordMetadataLimits.tagLength)) {
            message.warning(`标签最多 ${relationshipRecordMetadataLimits.tagLength} 个字符。`);
            return;
          }
          onChange(next);
        }}
      />}
    </div>
  </div>;
}

export function RelationshipCustomPropertyRow({ property, original, onChange, onRemove, disabled }: {
  property: CustomProperty;
  original?: CustomProperty;
  onChange?: (property: CustomProperty) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const displayed = onChange ? original : property;
  return <div className="relationship-object-wiki__property relationship-object-wiki__property--custom">
    <dt>
      <div className="relationship-object-wiki__value-slot">
        <span className="relationship-object-wiki__custom-name" aria-hidden={onChange ? true : undefined}>{displayed?.name || '—'}</span>
        {onChange && <Input aria-label="自定义属性名称" placeholder="属性名称" value={property.name} disabled={disabled}
          maxLength={relationshipRecordMetadataLimits.nameLength}
          autoFocus={!original && !property.name}
          onChange={event => onChange({ ...property, name: event.target.value })} />}
      </div>
    </dt>
    <dd className="relationship-object-wiki__property-value">
      <div className="relationship-object-wiki__value-slot">
        <span className="relationship-object-wiki__value" aria-hidden={onChange ? true : undefined}>{displayed?.value || '—'}</span>
        {onChange && <Input.TextArea aria-label="自定义属性值" placeholder="属性值" rows={1} value={property.value} disabled={disabled}
          maxLength={relationshipRecordMetadataLimits.valueLength}
          onChange={event => onChange({ ...property, value: event.target.value })} />}
      </div>
      {onRemove && <Button type="text" danger size="small" htmlType="button" icon={<DeleteOutlined />} disabled={disabled}
        aria-label={property.name ? `删除属性 ${property.name}` : '删除未命名属性'} onClick={onRemove} />}
    </dd>
  </div>;
}
