import { useEffect, useState, type ReactNode } from 'react';
import { FileTextOutlined } from '@/components/Icon/ant';
import { Button, Spin } from 'antd';
import KnowledgeReader from '@/components/KnowledgeReader';
import SettingsTabs from '@/components/SettingsTabs';
import { getAIRegistrySkillInstructions, type RegistrySkillDocument } from '@/services/api';
import { getSkillDisplayDescription, getToolHelp, toolAvailability, toolEffects } from './aiRegistryHelp';
import './registry-details.css';

interface SkillRecord {
  name: string;
  description?: string;
  instructions?: string | null;
  source_markdown?: string | null;
  default_tool?: string | null;
  allowed_tools?: string[];
  permission_capability?: string;
  domain?: string;
  risk_level?: string;
}

interface ToolRecord {
  name: string;
  title?: string;
  description?: string;
  enabled?: boolean;
  handler_key?: string;
  side_effect?: string;
  risk_level?: string;
  permission_check?: string;
  dry_run_supported?: boolean;
  audit_required?: boolean;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

type Labels = { label: string; value: string }[];

export const registryRisks: Labels = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '严重', value: 'critical' },
];

function labelFor(value: string | undefined, options: Labels) {
  return options.find(option => option.value === value)?.label || value;
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="registry-detail__facts">
    {items.filter(([, value]) => value != null && value !== '').map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}

function overviewOf(body: string, bundled: boolean) {
  const instructions = body.trim().replace(/^# [^\n]+\n+/, '');
  if (!bundled) return { instructions };
  const examples = /^## 使用示例[^\S\r\n]*\r?\n/m.exec(instructions);
  if (!examples) return { instructions };
  const tail = instructions.slice(examples.index + examples[0].length);
  const quote = /^> (.+)$/m.exec(tail);
  if (!quote) return { instructions };
  return {
    instructions: instructions.slice(0, examples.index).trimEnd(),
    example: quote[1],
    remaining: (tail.slice(0, quote.index) + tail.slice(quote.index + quote[0].length)).trim(),
  };
}

function sourceOf(skill: SkillRecord, document: RegistrySkillDocument | undefined, body: string, description: string) {
  if (skill.source_markdown) return { text: skill.source_markdown, label: '导入原文' };
  if (document?.source_markdown && skill.instructions == null) {
    return { text: document.source_markdown, label: `${document.package_name}/SKILL.md` };
  }
  const name = document?.package_name || skill.name.replace(/[._]/g, '-');
  return {
    text: `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`,
    label: '当前配置预览',
  };
}

export function SkillDetails({ skill, tools, capabilities, domains, recordInfo }: {
  skill: SkillRecord;
  tools: ReadonlyMap<string, ToolRecord>;
  capabilities: Labels;
  domains: Labels;
  recordInfo: ReactNode;
}) {
  const [document, setDocument] = useState<RegistrySkillDocument>();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (skill.instructions != null) return;
    const controller = new AbortController();
    getAIRegistrySkillInstructions(skill.name, controller.signal).then(
      ({ data }) => { if (!controller.signal.aborted) setDocument(data.data); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [skill.name, skill.instructions, attempt]);

  const description = getSkillDisplayDescription(skill.name, skill.description);
  const toolNames = [...new Set([skill.default_tool, ...(skill.allowed_tools || [])].filter((name): name is string => Boolean(name)))];
  const body = skill.instructions ?? document?.instructions ?? '';
  const overview = overviewOf(body, Boolean(document?.source_markdown));
  const source = sourceOf(skill, document, body, description);
  const needsSource = !document && skill.instructions == null;
  const status = needsSource && (failed ? <div className="registry-detail__state" role="alert">
    技能正文读取失败
    <Button size="small" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重试</Button>
  </div> : <div className="registry-detail__state" role="status"><Spin size="small" /> 正在读取技能正文</div>);

  return <SettingsTabs className="registry-detail__tabs" items={[
    { key: 'overview', label: '概览', children: <>
      {description && <p className="registry-detail__purpose">{description}</p>}
      {overview.example && <div className="registry-detail__example">
        <span>典型请求</span>
        <p>{overview.example}</p>
      </div>}
      <section className="registry-detail__instructions" aria-label="执行步骤">
        <h3>执行步骤</h3>
        {status || (overview.instructions ? <KnowledgeReader source={overview.instructions} /> : <p>暂无技能正文。</p>)}
      </section>
      {overview.remaining && <details className="registry-detail__fold">
        <summary>示例补充</summary>
        <KnowledgeReader source={overview.remaining} />
      </details>}
      <details className="registry-detail__fold">
        <summary>平台配置</summary>
        <Facts items={[
          ['注册 ID', <code>{skill.name}</code>],
          ['包版本', document?.version],
          ['所需能力', labelFor(skill.permission_capability, capabilities)],
          ['业务域', labelFor(skill.domain, domains)],
          ['风险等级', labelFor(skill.risk_level, registryRisks)],
        ]} />
        <h3>工具映射</h3>
        {toolNames.length === 0 ? <p>未配置工具。</p> : <ul className="registry-detail__tools">
          {toolNames.map(name => {
            const tool = tools.get(name);
            return <li key={name}>
              <strong>{getToolHelp(name)?.title || tool?.title || name}</strong>
              <span>{name === skill.default_tool ? '默认 · ' : ''}{toolAvailability(tool)}</span>
              <code>{name}</code>
            </li>;
          })}
        </ul>}
        {recordInfo}
      </details>
    </> },
    { key: 'source', label: 'SKILL.md', children: (skill.source_markdown ? null : status) || <>
      <p className="registry-detail__source-label"><FileTextOutlined /> {source.label}</p>
      <pre className="registry-detail__code" aria-label="SKILL.md 源码"><code>{source.text}</code></pre>
    </> },
  ]} />;
}

function Schema({ value, title }: { value?: Record<string, unknown>; title: string }) {
  return <section className="registry-detail__schema">
    <h3>{title}</h3>
    {value && Object.keys(value).length > 0
      ? <pre className="registry-detail__code" aria-label={title}><code>{JSON.stringify(value, null, 2)}</code></pre>
      : <p>暂无结构定义。</p>}
  </section>;
}

export function ToolDetails({ tool, capabilities, recordInfo }: {
  tool: ToolRecord;
  capabilities: Labels;
  recordInfo: ReactNode;
}) {
  const help = getToolHelp(tool.name);
  const purpose = help?.purpose || tool.description;
  const availability = toolAvailability(tool);
  return <SettingsTabs className="registry-detail__tabs" items={[
    { key: 'overview', label: '概览', children: <>
      {purpose && <p className="registry-detail__purpose">{purpose}</p>}
      {tool.handler_key?.startsWith('ui.component_page.') && <p className="registry-detail__example">
        在业务页面的 AI 助手中使用。改动先显示在画布草稿，复核后可手动保存。
      </p>}
      {availability === '待接入' && <p className="registry-detail__example">当前 AI 无法调用此工具。</p>}
      <section className="registry-detail__instructions" aria-label="执行策略">
        <h3>执行策略</h3>
        <Facts items={[
          ['操作类型', tool.side_effect && (toolEffects[tool.side_effect] || tool.side_effect)],
          ['所需能力', labelFor(tool.permission_check, capabilities)],
          ['风险等级', labelFor(tool.risk_level, registryRisks)],
          ['支持预演', tool.dry_run_supported === undefined ? undefined : tool.dry_run_supported ? '是' : '否'],
          ['必须审计', tool.audit_required === undefined ? undefined : tool.audit_required ? '是' : '否'],
        ]} />
      </section>
      <details className="registry-detail__fold">
        <summary>平台配置</summary>
        <Facts items={[
          ['工具标识', <code>{tool.name}</code>],
          ['注册名称', help && tool.title !== help.title ? tool.title : undefined],
          ['业务处理器', tool.handler_key && <code>{tool.handler_key}</code>],
        ]} />
        {tool.description && tool.description !== purpose && <section className="ai-registry-dialog-section">
          <h4>注册描述</h4>
          <p>{tool.description}</p>
        </section>}
        {recordInfo}
      </details>
    </> },
    { key: 'schema', label: '输入与输出', children: <>
      <Schema title="输入结构" value={tool.input_schema} />
      <Schema title="输出结构" value={tool.output_schema} />
    </> },
  ]} />;
}
