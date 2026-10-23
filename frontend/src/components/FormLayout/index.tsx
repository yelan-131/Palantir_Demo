import React from 'react';
import { Collapse, Tabs } from 'antd';
import { getControlAppearance, getControlColumnSpan, getControlPresentation, layoutSlots, type FormLayoutNode } from '@/utils/formLayout';
import './style.css';
export default function FormLayout({ nodes, renderField, isFieldVisible, gap = 12 }: { nodes: FormLayoutNode[]; gap?: number; isFieldVisible?: (fieldName: string) => boolean; renderField: (node: FormLayoutNode) => React.ReactNode }) {
  const render = (items: FormLayoutNode[], gap = 12): React.ReactNode => <div className="runtime-layout-grid" style={{ gap }}>{items.map(node => {
    const descendantNames = (item: FormLayoutNode): string[] => item.fieldName ? [item.fieldName] : (item.children || []).flatMap(descendantNames);
    const names = descendantNames(node);
    if (isFieldVisible && names.length && names.every(name => !isFieldVisible(name))) return null;
    let content: React.ReactNode;
    const children = node.children || [];
    if (node.kind === 'field') content = renderField(node);
    else if (node.kind === 'divider') content = <h4 className="runtime-layout-divider">{node.label}</h4>;
    else if (node.kind === 'tabs') content = <Tabs className="runtime-layout-tabs" items={layoutSlots({ ...node, controlType: 'tabs' }).map(tab => ({ key: tab.id, label: tab.label, forceRender: true, children: render(children.filter(child => child.slotId === tab.id)) }))} />;
    else {
      const body = node.kind === 'two-columns' ? <div className="runtime-layout-columns" style={{ '--layout-ratios': layoutSlots({ ...node, controlType: 'two-columns' }).map((_, i) => `${node.layout?.ratios?.[i] || 1}fr`).join(' '), gap: node.layout?.gap ?? 12 } as React.CSSProperties}>{layoutSlots({ ...node, controlType: 'two-columns' }).map(slot => <div key={slot.id}>{render(children.filter(child => child.slotId === slot.id))}</div>)}</div> : render(children, node.layout?.gap ?? 12);
      content = node.layout?.collapsible ? <Collapse defaultActiveKey={node.layout.defaultCollapsed ? [] : [node.id]} items={[{ key: node.id, label: node.label, children: body, forceRender: true }]} /> : <section className="runtime-layout-group"><h4>{node.label}</h4>{body}</section>;
    }
    if (content == null) return null;
    const presentation = getControlPresentation(node.presentation);
    const appearance = getControlAppearance(node.presentation);
    const fieldClass = node.kind === 'field' ? ` runtime-layout-field runtime-label-${presentation.labelPosition} runtime-label-align-${presentation.labelAlign}` : '';
    return <div key={node.id} className={`runtime-layout-item runtime-layout-width-${node.width || 'full'}${presentation.startNewRow ? ' is-start-new-row' : ''}${fieldClass} ${node.kind === 'field' ? appearance.className : ''}`} style={{
      ...(node.kind === 'field' ? appearance.style : {}),
      marginBottom: presentation.spacingAfter,
      '--layout-span': getControlColumnSpan(node.width),
      '--runtime-label-width': `${presentation.labelWidth}px`,
    } as React.CSSProperties}>{content}</div>;
  })}</div>;
  return <>{render(nodes,gap)}</>;
}
