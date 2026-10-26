import React, { useState } from 'react';
import { Alert, Button, Input, Modal, Space, Tag } from 'antd';
import { DeleteOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons';
import { staticOptionErrors, type SelectOption } from '@/utils/selectOptions';
import './static-options.css';

export default function StaticOptionsEditor({ options, onChange }: { options: SelectOption[]; onChange: (options: SelectOption[]) => void }) {
  const [batchOpen, setBatchOpen] = useState(false);
  const [batch, setBatch] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const errors = staticOptionErrors(options);
  const move = (from: number, to: number) => {
    const next = [...options]; const [item] = next.splice(from, 1); next.splice(to, 0, item); onChange(next);
  };
  return <div className="static-options-editor">
    <div className="static-options-heading"><strong>静态选项 · {options.length} 项</strong><Button size="small" onClick={() => { setBatch(''); setBatchOpen(true); }}>批量添加</Button></div>
    <div className="static-option-columns"><span>显示名称</span><span>存储值</span></div>
    {options.map((option, index) => <div className="static-option-row" key={index}
      onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragIndex !== null && dragIndex !== index) move(dragIndex, index); setDragIndex(null); }}>
      <span draggable onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(null)} className="static-option-drag" title="拖动排序"><HolderOutlined /></span>
      <Input size="small" aria-label={`选项 ${index + 1} 显示名称`} value={option.label} onChange={event => onChange(options.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
      <Input size="small" aria-label={`选项 ${index + 1} 存储值`} value={option.value} onChange={event => onChange(options.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />
      <Button size="small" type="text" aria-label={`上移选项 ${index + 1}`} disabled={index === 0} onClick={() => move(index, index - 1)}>↑</Button>
      <Button size="small" type="text" danger aria-label={`删除选项 ${index + 1}`} icon={<DeleteOutlined />} onClick={() => onChange(options.filter((_, i) => i !== index))} />
    </div>)}
    <Button block size="small" icon={<PlusOutlined />} onClick={() => onChange([...options, { label: '', value: '' }])}>添加选项</Button>
    <small>名称用于展示，存储值用于保存。已有数据使用的存储值请保持稳定。</small>
    {!!errors.length && <Alert type="warning" showIcon message={errors[0]} />}
    {!!options.length && <div className="static-options-preview"><small>候选预览</small><Space size={[2, 4]} wrap>{options.map((item, i) => <Tag key={i} title={`存储值：${item.value}`}>{item.label || '未命名'}</Tag>)}</Space></div>}
    <Modal title="批量添加选项" open={batchOpen} onCancel={() => setBatchOpen(false)} okText="添加" cancelText="取消" okButtonProps={{ disabled: !batch.trim() }} onOk={() => {
      const rows = batch.split(/\r?\n/).filter(line => line.trim()).map(line => { const [label, ...value] = line.split('\t'); return { label: label.trim(), value: value.length ? value.join('\t').trim() : label.trim() }; });
      onChange([...options, ...rows]); setBatchOpen(false);
    }}><p>每行一个选项；可从 Excel 粘贴两列：显示名称、存储值。只有一列时，两者相同。</p><Input.TextArea aria-label="批量选项" rows={8} value={batch} onChange={event => setBatch(event.target.value)} placeholder={'启用\tenabled\n停用\tdisabled'} /></Modal>
  </div>;
}
