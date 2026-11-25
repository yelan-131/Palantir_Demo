import React, {useEffect, useState} from 'react';
import {Alert} from 'antd';
import DynamicPage, {type RecordListComponentProps} from '../DynamicPage';
import FilterWidget from './FilterWidget';
import {useListConfigurationPreview} from './ListConfigurationPreview';
import type {FilterContribution, PageWidget} from './model';

export default function RecordListWidget({widget, sourceId, listSettings, ...props}: RecordListComponentProps & {
  widget: PageWidget;
  sourceId: number;
}) {
  const [query, setQuery] = useState<FilterContribution>();
  const [selectedScheme, setSelectedScheme] = useState<string>();
  const preview = useListConfigurationPreview(widget.id);
  const schemeSelection = preview?.filterScheme ?? {id:selectedScheme, onSelect:setSelectedScheme};
  const displayGroups = listSettings?.displayGroups;
  const displayGroup = preview
    ? displayGroups?.find(group => group.id === preview.displayGroup.id) ?? displayGroups?.[0]
    : undefined;
  const previewSettings = displayGroup ? {...listSettings, displayGroups:[displayGroup]} : listSettings;
  const schemes = widget.filterSettings?.schemes;
  const activeSchemeId = (schemes?.find(scheme => scheme.id === schemeSelection.id) ?? schemes?.[0])?.id;
  const enabled = widget.showFilters !== false && schemes?.length !== 0;
  const localQuery = enabled && query?.schemeId === activeSchemeId ? query : undefined;
  useEffect(() => {
    setQuery(current => current?.schemeId === activeSchemeId ? current : undefined);
  }, [activeSchemeId]);
  const ready = localQuery?.ready ?? !(enabled && widget.filterSettings?.schemes == null && widget.filterSettings?.requiredFields?.length);
  const search = [props.externalSearch, localQuery?.search].filter(Boolean).join(' ');

  return <>
    {enabled && <FilterWidget widget={widget} sourceId={sourceId} onChange={setQuery} inline schemeSelection={schemeSelection} />}
    {ready
      ? <DynamicPage {...props} formSlug={String(sourceId)} display="list" showRecordMetadata listSettings={previewSettings} externalSearch={search}
          externalFilters={[...(props.externalFilters??[]), ...(localQuery?.filters??[])]} />
      : <Alert type="info" message="请先填写必填筛选条件并查询" />}
  </>;
}
