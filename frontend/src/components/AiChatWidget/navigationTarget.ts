export function resolveNavigationTarget<T>(
  items: T[], query: string, label: (item: T) => string, code?: (item: T) => string,
): T | undefined {
  const normalized = query.trim().replace(/^[「“"]|[」”"]$/g, '').toLocaleLowerCase();
  const variants = [normalized];
  if (code && normalized.endsWith('应用')) variants.push(normalized.slice(0, -2).trim());
  for (const name of variants.filter(Boolean)) {
    const exact = items.filter(item => label(item).toLocaleLowerCase() === name || code?.(item).toLocaleLowerCase() === name);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error(`有多个目标叫「${query}」，请提供完整名称或编码。`);
  }
  const search = variants[variants.length - 1];
  if (!search) return undefined;
  const matches = items.filter(item => label(item).toLocaleLowerCase().includes(search));
  if (matches.length > 1) {
    throw new Error(`找到多个目标（${matches.slice(0, 5).map(label).join('、')}），请指定要打开的那一个。`);
  }
  return matches[0];
}
