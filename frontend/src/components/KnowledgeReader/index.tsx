import { Fragment, type ReactNode } from 'react';
import { parseKnowledgeMarkdown, safeKnowledgeHref } from '../../utils/knowledgeMarkdown';

type WikiReference = (target: string) => ReactNode;

function inlineText(text: string, renderReference?: WikiReference): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('[[') && part.endsWith(']]')) {
      const target = part.slice(2, -2);
      return <Fragment key={index}>{renderReference?.(target) ?? <span className="knowledge-wiki-reference">{target}</span>}</Fragment>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeKnowledgeHref(link[2]);
      return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{link[1]}</a> : <span key={index}>{link[1]}</span>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export default function KnowledgeReader({ source, renderReference }: { source: string; renderReference?: WikiReference }) {
  const inline = (text: string) => inlineText(text, renderReference);
  return <div className="knowledge-markdown-reader">{parseKnowledgeMarkdown(source).map((block, index) => {
    if (block.type === 'heading') {
      const content = inline(block.text);
      switch (block.level) {
        case 1: return <h1 key={index} id={block.id}>{content}</h1>;
        case 2: return <h2 key={index} id={block.id}>{content}</h2>;
        case 3: return <h3 key={index} id={block.id}>{content}</h3>;
        case 4: return <h4 key={index} id={block.id}>{content}</h4>;
        case 5: return <h5 key={index} id={block.id}>{content}</h5>;
        default: return <h6 key={index} id={block.id}>{content}</h6>;
      }
    }
    if (block.type === 'table') return <div className="knowledge-reader-table" key={index}><table><thead><tr>{block.headers.map((cell, i) => <th key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{block.rows.map((row, i) => <tr key={i}>{block.headers.map((_, j) => <td key={j}>{inline(row[j] || '')}</td>)}</tr>)}</tbody></table></div>;
    if (block.type === 'list') { const items = block.items.map((item, i) => <li key={i}>{inline(item)}</li>); return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>; }
    if (block.type === 'rule') return <hr key={index} />;
    if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>;
    if (block.type === 'quote') return <blockquote key={index}>{inline(block.text)}</blockquote>;
    return <p key={index}>{inline(block.text)}</p>;
  })}</div>;
}
