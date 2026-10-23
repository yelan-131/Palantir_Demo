export type KnowledgeBlock =
  | { type: 'heading'; level: number; text: string; id: string }
  | { type: 'paragraph' | 'quote' | 'code'; text: string }
  | { type: 'list'; items: string[]; ordered: boolean }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'rule' };

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
const tableSeparator = (line: string) => line.includes('|') && cells(line).every(cell => /^:?-{3,}:?$/.test(cell));

/** Omit converter boilerplate in reading view while preserving the original source. */
export function prepareKnowledgeMarkdown(source: string, title: string) {
  let content = source.replace(/\r\n?/g, '\n').trim();
  content = content.replace(/^# [^\n]+\.(?:docx?|pdf|xlsx?|png|jpe?g)\s*\n\s*>[^\n]*converted[^\n]*Markdown[^\n]*\n\s*/i, '');
  const firstLine = content.split('\n')[0];
  if (firstLine?.replace(/^#\s+/, '').trim() === title.trim() && firstLine.startsWith('# ')) content = content.slice(firstLine.length).trimStart();
  return content;
}

/** Parse a read-only Markdown subset. Raw HTML remains text, never executable markup. */
export function parseKnowledgeMarkdown(source: string): KnowledgeBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const nextContent = (index: number) => {
    while (index < lines.length && !lines[index].trim()) index++;
    return index;
  };
  const blocks: KnowledgeBlock[] = [];
  let headingIndex = 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const fence = line.match(/^(`{3,}|~{3,})/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      blocks.push({ type: 'code', text: body.join('\n') });
      if (i < lines.length) i++;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], id: `knowledge-heading-${headingIndex++}` });
      i++; continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) { blocks.push({ type: 'rule' }); i++; continue; }
    const separatorIndex = nextContent(i + 1);
    if (line.includes('|') && separatorIndex < lines.length && tableSeparator(lines[separatorIndex])) {
      const headers = cells(line);
      const rows: string[][] = [];
      i = separatorIndex + 1;
      while (nextContent(i) < lines.length && lines[nextContent(i)].includes('|')) {
        i = nextContent(i);
        rows.push(cells(lines[i++]));
      }
      blocks.push({ type: 'table', headers, rows }); continue;
    }
    const listMatch = line.match(/^(?:([-+*])|(\d+)\.)\s+(.+)/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].trim().match(/^(?:([-+*])|(\d+)\.)\s+(.+)/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]); i++;
      }
      blocks.push({ type: 'list', items, ordered }); continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) quote.push(lines[i++].trim().replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: quote.join('\n') }); continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(?:#{1,6}\s|>|[-+*]\s|\d+\.\s|`{3,}|~{3,}|-{3,}$|\*{3,}$|_{3,}$)/.test(lines[i].trim()) && !(lines[i].includes('|') && i + 1 < lines.length && tableSeparator(lines[i + 1]))) paragraph.push(lines[i++].trim());
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

export function safeKnowledgeHref(href: string): string | undefined {
  return /^(https?:\/\/|mailto:)/i.test(href.trim()) ? href.trim() : undefined;
}
