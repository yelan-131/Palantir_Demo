import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Spin } from 'antd';
import { CheckOutlined, DownOutlined, EyeOutlined, HistoryOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import { getAnalyticsVersion, listAnalyticsVersions } from './analyticsApi';
import { analyticsErrorMessage } from './analyticsEditorState';
import type { AnalyticsVersion, AnalyticsVersionDetail, RuntimeAnalyticsDesign } from './analyticsTypes';
import { compareAnalyticsVersions, formatAnalyticsVersionTime, type AnalyticsVersionChangeKind } from './analyticsVersionUtils';
import './analytics-version-history.css';

export interface AnalyticsVersionHistoryProps {
  programId: string;
  draft: RuntimeAnalyticsDesign;
  refreshKey?: string;
  previewVersion?: number;
  disabled?: boolean;
  onPreview: (version: AnalyticsVersionDetail) => void;
  onStopPreview: () => void;
  onRestore: (version: AnalyticsVersionDetail) => void;
}

const changeNames: Record<AnalyticsVersionChangeKind, string> = { added: '新增', removed: '移除', modified: '调整', reordered: '顺序' };

export default function AnalyticsVersionHistory({ programId, draft, refreshKey, previewVersion, disabled = false, onPreview, onStopPreview, onRestore }: AnalyticsVersionHistoryProps) {
  const [items, setItems] = useState<AnalyticsVersion[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<number>();
  const [detail, setDetail] = useState<AnalyticsVersionDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const context = `${programId}\u0000${refreshKey || ''}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  const id = useId();

  const loadPage = useCallback(async (offset = 0) => {
    const request = ++listRequest.current;
    setLoading(true);
    setListError('');
    try {
      const response = await listAnalyticsVersions(programId, offset);
      if (currentContext.current !== context || request !== listRequest.current) return;
      const page = response.data.items;
      setItems(previous => offset === 0 ? page : [...previous, ...page.filter(item => !previous.some(existing => existing.version === item.version))]);
      setTotal(response.data.total);
      setNextOffset(offset + page.length);
    } catch (error) {
      if (currentContext.current === context && request === listRequest.current) setListError(analyticsErrorMessage(error, '版本历史读取失败，请重试。'));
    } finally {
      if (currentContext.current === context && request === listRequest.current) setLoading(false);
    }
  }, [programId, context]);

  useEffect(() => {
    setItems([]);
    setTotal(0);
    setNextOffset(0);
    setSelected(undefined);
    setDetail(undefined);
    setDetailError('');
    setDetailLoading(false);
    ++detailRequest.current;
    void loadPage();
    return () => { ++listRequest.current; ++detailRequest.current; };
  }, [loadPage]);

  const loadDetail = async (version: number) => {
    if (disabled) return;
    const request = ++detailRequest.current;
    setSelected(version);
    setDetail(undefined);
    setDetailError('');
    setDetailLoading(true);
    try {
      const response = await getAnalyticsVersion(programId, version);
      if (currentContext.current === context && request === detailRequest.current) setDetail(response.data);
    } catch (error) {
      if (currentContext.current === context && request === detailRequest.current) setDetailError(analyticsErrorMessage(error, '此版本读取失败，请重试。'));
    } finally {
      if (currentContext.current === context && request === detailRequest.current) setDetailLoading(false);
    }
  };

  const selectVersion = (version: number) => {
    if (disabled) return;
    if (selected === version) {
      ++detailRequest.current;
      setSelected(undefined);
      setDetail(undefined);
      setDetailLoading(false);
      setDetailError('');
    } else void loadDetail(version);
  };
  const comparison = useMemo(() => detail && detail.version === selected ? compareAnalyticsVersions(detail.design, draft) : undefined, [detail, draft, selected]);

  return <section className="analytics-version-history" aria-label="看板版本历史" aria-busy={loading && !items.length}>
    <div className="analytics-version-intro">
      <HistoryOutlined aria-hidden />
      <div><strong>每次发布，都有记录</strong><p>版本保存看板配置。预览历史版本时，仍使用当前业务数据。</p></div>
    </div>
    {previewVersion !== undefined && <div className="analytics-version-preview" role="status">
      <span><EyeOutlined aria-hidden /> 正在预览 V{previewVersion}</span>
      <Button type="link" size="small" disabled={disabled} onClick={() => { if (!disabled) onStopPreview(); }}>返回当前草稿</Button>
    </div>}
    <div className="analytics-version-list-heading"><strong>发布记录</strong><span>{loading && !items.length ? '读取中' : `共 ${total} 个版本`}</span></div>
    {loading && !items.length && <div className="analytics-version-loading"><Spin size="small" /><span role="status">正在读取版本历史…</span></div>}
    {!loading && !listError && !items.length && <div className="analytics-version-empty">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有发布记录" />
      <p>发布看板后，版本会保存在这里。草稿保存不会创建发布版本。</p>
    </div>}
    <ol className="analytics-version-list">
      {items.map(item => {
        const expanded = selected === item.version;
        const previewing = previewVersion === item.version;
        return <li key={item.version} className={`analytics-version-item${expanded ? ' is-expanded' : ''}${previewing ? ' is-previewing' : ''}`}>
          <button type="button" className="analytics-version-select" aria-expanded={expanded} aria-controls={`${id}-version-${item.version}`} disabled={disabled} onClick={() => selectVersion(item.version)}>
            <span className="analytics-version-topline"><strong>V{item.version}</strong>{item.current && <span className="analytics-version-live"><span />当前生效</span>}{previewing && <span className="analytics-version-preview-label">预览中</span>}<DownOutlined className="analytics-version-chevron" aria-hidden /></span>
            <span className="analytics-version-date">{formatAnalyticsVersionTime(item.publishedAt)}</span>
            {item.note && <span className="analytics-version-note">{item.note}</span>}
            <span className="analytics-version-meta"><span>{item.publishedByName || (item.publishedBy != null ? `用户 ${item.publishedBy}` : '发布人未记录')}</span><span>{item.scope === 'analytics' ? '看板发布' : item.scope === 'form' ? '随表单发布' : '发布记录'}</span></span>
            <span className="analytics-version-counts"><span>{item.summary.widgets} 个组件</span><span>{item.summary.datasets} 个数据集</span><span>{item.summary.metrics} 个指标</span></span>
          </button>
          {expanded && <div className="analytics-version-detail" id={`${id}-version-${item.version}`}>
            {detailLoading && <div className="analytics-version-loading"><Spin size="small" /><span role="status">正在读取此版本…</span></div>}
            {detailError && <Alert type="error" showIcon message={detailError} action={<Button size="small" disabled={disabled} onClick={() => void loadDetail(item.version)}>重试</Button>} />}
            {detail && detail.version === item.version && comparison && <>
              <div className="analytics-version-diff-heading">当前草稿相对此版本</div>
              {!!comparison.incompatibleSections.length && <Alert className="analytics-version-compatibility" type="warning" showIcon message="部分配置格式无法比较" description={`${comparison.incompatibleSections.join('、')}格式不兼容，请检查配置。`} />}
              {comparison.changed ? <div className="analytics-version-diff">
                <div className="analytics-version-diff-summary">{(Object.keys(changeNames) as AnalyticsVersionChangeKind[]).filter(kind => comparison.counts[kind] > 0).map(kind => <span key={kind} className={`analytics-version-change-${kind}`}>{changeNames[kind]} {comparison.counts[kind]}</span>)}</div>
                {comparison.groups.map(group => <div className="analytics-version-diff-group" key={group.key}><strong>{group.name}</strong><ul>{group.changes.map((change, index) => <li key={`${change.kind}-${change.key}-${index}`}><span className={`analytics-version-change-label analytics-version-change-${change.kind}`}>{changeNames[change.kind]}</span><span>{change.name}</span></li>)}</ul></div>)}
              </div> : !comparison.incompatibleSections.length && <p className="analytics-version-unchanged"><CheckOutlined aria-hidden /> 与当前草稿一致</p>}
              <div className="analytics-version-actions">
                <Button size="small" icon={<EyeOutlined />} disabled={disabled || !comparison.snapshotCompatible && !previewing} onClick={() => { if (!disabled && (previewing || comparison.snapshotCompatible)) previewing ? onStopPreview() : onPreview(detail); }}>{previewing ? '结束预览' : '预览此版本'}</Button>
                <Button size="small" icon={<RollbackOutlined />} disabled={disabled || !comparison.changed || !comparison.snapshotCompatible} onClick={() => { if (!disabled && comparison.changed && comparison.snapshotCompatible) onRestore(detail); }}>恢复到草稿</Button>
              </div>
              <p className="analytics-version-restore-hint">恢复后可继续调整，发布后才会对用户生效。</p>
            </>}
          </div>}
        </li>;
      })}
    </ol>
    {listError && <Alert className="analytics-version-error" type="error" showIcon message={listError} action={<Button size="small" disabled={disabled || loading} icon={<ReloadOutlined />} onClick={() => { if (!disabled) void loadPage(items.length ? nextOffset : 0); }}>重试</Button>} />}
    {!listError && items.length > 0 && nextOffset < total && <Button className="analytics-version-more" block loading={loading} disabled={disabled || loading} onClick={() => { if (!disabled) void loadPage(nextOffset); }}>加载更多版本</Button>}
    {!loading && !listError && items.length > 0 && nextOffset >= total && <p className="analytics-version-end">已展示全部发布记录</p>}
  </section>;
}
