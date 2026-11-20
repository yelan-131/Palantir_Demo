import { useMemo } from 'react';
import { buildTracePresentation } from './tracePresentation';
import type { TracePresentationInput, TracePresentationRow } from './tracePresentation';

interface Props {
  items: TracePresentationInput[];
  active: boolean;
  awaitingConfirmation?: boolean;
}

function describeOperation(row: TracePresentationRow): string | undefined {
  if (row.kind === 'skill') return `读取技能「${row.content}」`;
  if (row.kind !== 'tool' || !row.hasResult) return undefined;
  const action = row.queryContext || row.title;
  if (row.status === 'completed' && row.resultCount !== undefined) {
    return row.resultCount === 0 ? `${action}，未找到匹配项` : `${action}，返回 ${row.resultCount} 项`;
  }
  const detail = row.detail === '404: Form not found' ? '，表单不存在（404）' : '';
  return `${action}，${row.statusLabel}${detail}`;
}

export function AgentExecutionTrace({ items, active, awaitingConfirmation }: Props) {
  const { rows } = useMemo(() => buildTracePresentation(items), [items]);
  const reasoning = rows.filter(row => row.source === 'reasoning');
  const diagnostics = rows.filter(row => row.source === 'dsh' || row.source === 'validation');
  const visibleSteps = rows.filter(row => !row.source);
  const explanation = [...new Set(visibleSteps.flatMap(row => describeOperation(row) || []))];
  const modelSteps = diagnostics.filter(row => row.source === 'dsh');
  const latestModelStep = modelSteps[modelSteps.length - 1];
  const phase = active ? '执行中' : awaitingConfirmation ? '待确认' : undefined;

  return <>
    {reasoning.length > 0 && (
      <details className="ai-agent-trace ai-agent-reasoning">
        <summary><span className="ai-agent-trace-title">模型推理</span></summary>
        <div className="ai-agent-reasoning-body">
          {reasoning.map(step => <p key={step.id}>{step.content}</p>)}
        </div>
      </details>
    )}
    {(visibleSteps.length > 0 || diagnostics.length > 0) && (
      <details className="ai-agent-trace" open={active}>
        <summary>
          <span className="ai-agent-trace-title">执行过程</span>
          {phase && <span className="ai-agent-trace-phase">{phase}</span>}
        </summary>
        {explanation.length > 0 && (
          <details className="ai-agent-trace-explanation">
            <summary>执行说明</summary>
            <ol>{explanation.map(statement => <li key={statement}>{statement}</li>)}</ol>
          </details>
        )}
        {(visibleSteps.length > 0 || (active && latestModelStep)) && (
          <div className="ai-agent-trace-list" role="log" aria-label="执行步骤" aria-relevant="additions text">
            {active && latestModelStep && <p className="ai-agent-trace-progress">{latestModelStep.content}</p>}
            {visibleSteps.map(row => row.kind === 'tool' || row.kind === 'skill' ? (
              <details className="ai-agent-trace-tool" data-status={row.status} key={row.id}>
                <summary>
                  <span className="ai-agent-trace-kind">{row.kind === 'skill' ? 'Skills' : 'Tools'}</span>
                  <span className="ai-agent-trace-tool-main">
                    <span className="ai-agent-trace-tool-label">{row.kind === 'skill' ? row.content : row.title}</span>
                    {row.queryContext && <span className="ai-agent-trace-condition">{row.queryContext}</span>}
                  </span>
                  <span className="ai-agent-trace-outcome">
                    <span className="ai-agent-trace-status">{row.kind === 'skill' ? '已读取' : row.statusLabel}</span>
                    {row.resultCount !== undefined && <span className="ai-agent-trace-count">{row.resultCount} 项</span>}
                  </span>
                </summary>
                <div className="ai-agent-trace-tool-detail">
                  {(row.tool || row.skillId) && <code>{row.tool || row.skillId}</code>}
                  {row.resultPreview && (
                    <>
                      <ul className="ai-agent-trace-result-list" aria-label="返回结果">
                        {row.resultPreview.items.map((item, index) => (
                          <li key={`${index}-${item.label}`} title={item.secondary}>{item.label}</li>
                        ))}
                      </ul>
                      {row.resultPreview.remaining > 0 && <p>另有 {row.resultPreview.remaining} 项</p>}
                    </>
                  )}
                  {row.detail && <p>{row.detail}</p>}
                </div>
              </details>
            ) : (
              <div className="ai-agent-trace-note" data-status={row.status} key={row.id}>{row.content}</div>
            ))}
          </div>
        )}
        {diagnostics.length > 0 && (
          <details className="ai-agent-trace-diagnostics">
            <summary>运行详情</summary>
            <ul>
              {diagnostics.map(step => <li key={step.id}>{step.content}</li>)}
            </ul>
          </details>
        )}
      </details>
    )}
  </>;
}
