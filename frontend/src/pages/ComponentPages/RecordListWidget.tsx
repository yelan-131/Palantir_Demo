import React, {useState} from 'react';
import {Alert} from 'antd';
import DynamicPage, {type RecordListComponentProps} from '../DynamicPage';
import FilterWidget from './FilterWidget';
import type {FilterContribution, PageWidget} from './model';

export default function RecordListWidget({widget, sourceId, ...props}: RecordListComponentProps & {
  widget: PageWidget;
  sourceId: number;
}) {
  const [query, setQuery] = useState<FilterContribution>();
  const enabled = widget.showFilters !== false && widget.filterSettings?.schemes?.length !== 0;
  const localQuery = enabled ? query : undefined;
  const ready = localQuery?.ready ?? !(enabled && widget.filterSettings?.schemes == null && widget.filterSettings?.requiredFields?.length);
  const search = [props.externalSearch, localQuery?.search].filter(Boolean).join(' ');

  return <>
    {enabled && <FilterWidget widget={widget} sourceId={sourceId} onChange={setQuery} inline />}
    {ready
      ? <DynamicPage {...props} formSlug={String(sourceId)} display="list" externalSearch={search}
          externalFilters={[...(props.externalFilters??[]), ...(localQuery?.filters??[])]} />
      : <Alert type="info" message="请先填写必填筛选条件并查询" />}
  </>;
}
