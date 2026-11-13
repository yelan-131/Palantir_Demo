import { useEffect, useState } from 'react';
import { Input } from 'antd';
import KnowledgeReader from '../../components/KnowledgeReader';
import { getAIRegistrySkillInstructions } from '../../services/api';

export default function SkillInstructions({ name, readOnly, value, onChange }: {
  name?: string;
  readOnly?: boolean;
  value?: string | null;
  onChange?: (value: string) => void;
}) {
  const [instructions, setInstructions] = useState<string | null>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!name || value != null) return;
    const request = new AbortController();
    getAIRegistrySkillInstructions(name, request.signal).then(
      response => {
        if (!request.signal.aborted) setInstructions(response.data.data.instructions);
      },
      () => {
        if (!request.signal.aborted) setFailed(true);
      },
    );
    return () => request.abort();
  }, [name, value]);

  const source = value ?? instructions;
  const loading = Boolean(name && source === undefined && !failed);

  return (
    <div className="ai-skill-instructions">
      {loading || (failed && value == null) ? (
        <p role="status">{loading ? '正在读取执行步骤…' : '执行步骤读取失败，请重新打开技能。'}</p>
      ) : readOnly ? (
        source ? <KnowledgeReader source={source} /> : <p>暂无执行步骤。</p>
      ) : (
        <Input.TextArea
          aria-label="执行步骤 Markdown"
          value={source ?? ''}
          maxLength={30000}
          autoSize={{ minRows: 10, maxRows: 20 }}
          placeholder="用 Markdown 写下操作顺序、工具及需要确认的环节"
          onChange={event => onChange?.(event.target.value)}
        />
      )}
    </div>
  );
}
