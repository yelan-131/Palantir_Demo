import { AlertOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { Modal } from 'antd';
import type { ReactNode } from 'react';
import './publish-review.css';

type CheckLevel = 'error' | 'warning' | 'suggestion';
type CheckItem = { level: CheckLevel; title: string; detail: string };

const checkLabels = { error: '阻断项', warning: '提醒', suggestion: '其余检查' } as const;
const checkIcons = { error: AlertOutlined, warning: WarningOutlined, suggestion: CheckCircleOutlined };

function CheckRows({ items }: { items: CheckItem[] }) {
  return <ul className="publish-review-rows">
    {items.map(({ level, title, detail }, index) => {
      const Icon = checkIcons[level];
      return <li className={`publish-review-row is-${level}`} key={`${title}-${index}`}>
        <Icon aria-hidden="true" />
        <div><strong>{title}</strong><p>{detail}</p></div>
      </li>;
    })}
  </ul>;
}

export default function PublishReviewDialog({ open, name, sourceImpact, checks, busy, onCancel, onPublish }: {
  open: boolean;
  name: string;
  sourceImpact?: ReactNode;
  checks: CheckItem[];
  busy: boolean;
  onCancel: () => void;
  onPublish: () => void;
}) {
  const groups = {
    error: checks.filter(item => item.level === 'error'),
    warning: checks.filter(item => item.level === 'warning'),
    suggestion: checks.filter(item => item.level === 'suggestion'),
  };
  const blocked = groups.error.length > 0;
  const StatusIcon = blocked ? AlertOutlined : CheckCircleOutlined;

  return <Modal
    centered
    className="form-designer-dialog publish-review"
    width={820}
    open={open}
    title="发布确认"
    okText="确认发布"
    cancelText="返回编辑"
    okButtonProps={{ disabled: blocked }}
    onCancel={onCancel}
    onOk={onPublish}
    confirmLoading={busy}
    destroyOnClose
  >
    <div className="publish-review-grid">
      <aside className="publish-review-overview" aria-label="发布概况">
        <div className={`publish-review-status${blocked ? ' is-blocked' : ''}`}>
          <StatusIcon aria-hidden="true" />
          <strong>{blocked ? '暂不能发布' : '可以发布'}</strong>
        </div>
        <dl className="publish-review-totals">
          {(['error', 'warning', 'suggestion'] as const).map(level =>
            <div key={level} className={`is-${level}`}><dt>{checkLabels[level]}</dt><dd>{groups[level].length}</dd></div>
          )}
        </dl>
        {sourceImpact ?? <div className="publish-review-source"><span>发布对象</span><strong>{name}</strong></div>}
      </aside>

      <div className="publish-review-checks" aria-label="发布检查结果" tabIndex={0}>
        {blocked && <section aria-label="阻断项">
          <h3>发布前必须处理</h3>
          <CheckRows items={groups.error} />
        </section>}
        {groups.warning.length > 0 && <section aria-label="提醒">
          <h3>发布前可复核</h3>
          <CheckRows items={groups.warning} />
        </section>}
        {!blocked && !groups.warning.length && <p className="publish-review-clear">未发现阻断项或提醒。</p>}
        {groups.suggestion.length > 0 && <details className="publish-review-details">
          <summary>其余检查 <span>{groups.suggestion.length} 项</span></summary>
          <CheckRows items={groups.suggestion} />
        </details>}
      </div>
    </div>
  </Modal>;
}
