import { CloseOutlined, DeleteOutlined, PlusOutlined } from '@/components/Icon/ant';
import { Button, Input, Tag, message } from 'antd';
import { useRef, useState } from 'react';
import { relationshipRecordMetadataLimits, type RelationshipRecordMetadata } from '../../services/objectRuntime';

type CustomProperty = RelationshipRecordMetadata['properties'][number];

export function RelationshipRecordTags({ tags, onChange, disabled }: {
  tags: readonly string[];
  onChange?: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState('');
  const addButton = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  if (!onChange && !tags.length) return null;

  function finish(accept: boolean, restoreFocus = false) {
    const names = accept ? pending.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) : [];
    const next = [...new Set([...tags, ...names])];
    if (names.some(tag => [...tag].length > relationshipRecordMetadataLimits.tagLength)) {
      message.warning(`标签最多 ${relationshipRecordMetadataLimits.tagLength} 个字符。`);
      if (restoreFocus) return;
    } else if (next.length > relationshipRecordMetadataLimits.tags) {
      message.warning(`最多添加 ${relationshipRecordMetadataLimits.tags} 个标签。`);
      if (restoreFocus) return;
    } else if (next.length !== tags.length) {
      onChange?.(next);
    }
    setPending('');
    setAdding(false);
    if (restoreFocus) requestAnimationFrame(() => addButton.current?.focus());
  }

  return <div className="relationship-object-wiki__tags" role="group" aria-label="记录标签">
    {tags.map(tag => <Tag key={tag} title={tag}>
      <span>{tag}</span>
      {onChange && <Button type="text" size="small" htmlType="button" icon={<CloseOutlined />}
        aria-label={`移除标签 ${tag}`} disabled={disabled} onClick={() => onChange(tags.filter(item => item !== tag))} />}
    </Tag>)}
    {onChange && (adding
      ? <Input className="relationship-object-wiki__tag-input" aria-label="新标签" size="small" autoFocus
        value={pending} disabled={disabled} onChange={event => setPending(event.target.value)}
        onBlur={() => finish(!disabled)} onKeyDown={event => {
          if (event.nativeEvent.isComposing || !['Enter', 'Escape', ',', '，'].includes(event.key)) return;
          event.preventDefault();
          finish(event.key !== 'Escape', true);
        }} />
      : <Button ref={addButton} className="relationship-object-wiki__tag-add" type="dashed" size="small"
        htmlType="button" icon={<PlusOutlined />} aria-label="添加标签"
        disabled={disabled || tags.length >= relationshipRecordMetadataLimits.tags} onClick={() => setAdding(true)}>标签</Button>)}
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
