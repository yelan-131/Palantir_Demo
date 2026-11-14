import {widgetSourceId, type PageDefinition} from './model';

export default function SourceImpactNotice({definition,sourceId,sourceName,mode}: {definition:PageDefinition;sourceId:number;sourceName:string;mode:'form'|'flow'}) {
  const consumers=definition.widgets.filter(widget=>widgetSourceId(definition,widget)===sourceId&&widget.type!=='workspace');
  return <section className="component-source-impact" role="note" aria-label="共享来源修改范围">
    <strong>共享来源：{sourceName}</strong>
    <p>{mode==='flow'?'当前编辑的是来源审批流程，同一来源的业务入口共用这套流程配置。':'当前编辑的是来源字段与录入配置，同一来源的业务入口共用这些配置。'}</p>
    <details><summary>本页关联组件 · {consumers.length} 个</summary>
      <ul>{consumers.map(widget=><li key={widget.id}>{widget.title}</li>)}</ul>
    </details>
    <p>这里只列出当前页面；其他页面的引用未统计。来源配置与页面布局分别保存和发布。</p>
  </section>;
}
