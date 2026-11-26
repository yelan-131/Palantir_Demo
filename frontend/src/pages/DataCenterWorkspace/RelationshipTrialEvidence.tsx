import KnowledgeReader from '../../components/KnowledgeReader';
import type { MaterialTrial, RelationshipTrialComparison } from './relationshipTrialComparison';

const strengthMetrics = [
  { label: '拉伸强度', initial: 'tensileInitialMpa', after: 'tensileAfterMpa' },
  { label: '弯曲强度', initial: 'flexuralInitialMpa', after: 'flexuralAfterMpa' },
] as const;

function strengthChange(initial?: number, after?: number) {
  return `${initial ?? '—'} → ${after ?? '—'}`;
}

function conditionLabel({ medium, temperatureC, durationH }: MaterialTrial['condition']) {
  return `${medium} · ${temperatureC} ℃ · ${durationH} 小时`;
}

function protocolText({ fluidFormulation, testMethod }: MaterialTrial) {
  return `介质配方 ${fluidFormulation ?? '未披露'} · 试验方法 ${testMethod ?? '未披露'}`;
}

export function RelationshipMaterialTrialMarkdown({ trials }: { trials: readonly MaterialTrial[] }) {
  if (!trials.length) return <p>暂无可查看的材料试验记录。</p>;
  return <>{trials.map(trial => {
    const markdown = [
      `**${conditionLabel(trial.condition)}**`,
      protocolText(trial),
      ['| 指标 | 初始（MPa） | 试验后（MPa） |', '| --- | ---: | ---: |',
        ...strengthMetrics.map(({ label, initial, after }) => `| ${label} | ${trial[initial] ?? '—'} | ${trial[after] ?? '—'} |`),
      ].join('\n'),
    ].join('\n\n');
    return <section key={trial.key} aria-label={`材料试验 · ${trial.key}`}>
      <KnowledgeReader source={markdown} />
      <a href={trial.sourceUrl} target="_blank" rel="noopener noreferrer">{trial.sourceName}</a>
    </section>;
  })}</>;
}

export default function RelationshipTrialEvidence({ comparison }: { comparison: RelationshipTrialComparison }) {
  const { condition, trials, basis } = comparison;
  const sources = [...new Map(trials.map(trial => [trial.sourceUrl, trial])).values()];
  const protocols = [...new Set(trials.map(protocolText))];
  return <div className="relationship-explorer-trial-evidence">
    <dl aria-label="工况对齐">
      <dt>介质</dt><dd>{condition.medium}</dd>
      <dt>温度</dt><dd>{condition.temperatureC} ℃</dd>
      <dt>时长</dt><dd>{condition.durationH} 小时</dd>
      <dt>可比依据</dt><dd>{basis}</dd>
    </dl>
    <div className="relationship-object-wiki__trials">
      <table aria-label="同工况强度对比">
        <thead><tr><th scope="col">初始 → 试验后<br />（MPa）</th>
          {trials.map(trial => <th scope="col" key={trial.key}>{trial.materialGrade}</th>)}
        </tr></thead>
        <tbody>{strengthMetrics.map(({ label, initial, after }) => <tr key={label}>
          <th scope="row">{label}</th>
          {trials.map(trial => <td key={trial.key}>{strengthChange(trial[initial], trial[after])}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {protocols.map(protocol => <p key={protocol}>{protocol}</p>)}
    <ul aria-label="试验来源">{sources.map(trial => <li key={trial.sourceUrl}>
      <a href={trial.sourceUrl} target="_blank" rel="noopener noreferrer">{trial.sourceName}</a>
    </li>)}</ul>
  </div>;
}
