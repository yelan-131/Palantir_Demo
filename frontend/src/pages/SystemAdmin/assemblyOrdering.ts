type OrderNode<T> = { key: string; children?: T[] };

export type MenuDrop =
  | { source: string; placement: 'first' | 'last' }
  | { source: string; target: string; placement: 'before' | 'after' | 'inside' };

export function menuRowDrop(source: string, target: string, position: number, targetPos: string, toGap: boolean): MenuDrop {
  const siblingIndex = Number(targetPos.slice(targetPos.lastIndexOf('-') + 1));
  return {source, target, placement: !toGap ? 'inside' : position < siblingIndex ? 'before' : 'after'};
}

export function moveAppOrder(order: number[], source: number, target: number, after: boolean): number[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return order;
  const next = order.filter(id => id !== source);
  next.splice(next.indexOf(target) + Number(after), 0, source);
  return next.every((id, index) => id === order[index]) ? order : next;
}

export function moveMenuNode<T extends OrderNode<T>>(nodes: T[], drop: MenuDrop, canContain: (node: T) => boolean): T[] {
  let source: T | undefined;
  const remove = (items: T[]): T[] => items.flatMap(item => {
    if (item.key === drop.source) {
      source = item;
      return [];
    }
    return [{...item, children: remove(item.children ?? [])}];
  });
  const remaining = remove(nodes);
  if (!source) return nodes;
  const moved = source;
  if (!('target' in drop)) {
    return drop.placement === 'first' ? [moved, ...remaining] : [...remaining, moved];
  }

  let inserted = false;
  const insert = (items: T[]): T[] => items.flatMap(item => {
    if (item.key !== drop.target) return [{...item, children: insert(item.children ?? [])}];
    if (drop.placement === 'inside' && !canContain(item)) return [item];
    inserted = true;
    if (drop.placement === 'before') return [moved, item];
    if (drop.placement === 'after') return [item, moved];
    return [{...item, children: [...(item.children ?? []), moved]}];
  });
  const next = insert(remaining);
  return inserted ? next : nodes;
}
