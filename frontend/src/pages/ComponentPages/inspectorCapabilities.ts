import type {WidgetType} from './model';

/** Source editors opened from the context menu retain their tabs until exited. */
export function inspectorTabs(type:WidgetType|undefined, sourceIsBusiness:boolean, sourceOpen=false) {
  const tabs=[{key:'basic',label:'基本'}];
  if(type!=='workspace')tabs.push({key:'data',label:'数据'});
  if(sourceOpen||(type==='record-list'&&sourceIsBusiness))tabs.push({key:'form',label:'录入'},{key:'flow',label:'流程'});
  return tabs;
}
