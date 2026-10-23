export interface TimelineRange { start: number; end: number }

export function timelineRange(items: Array<{ occurred_at?: string }>): TimelineRange | undefined {
  const times = items.map(item => item.occurred_at ? Date.parse(item.occurred_at) : NaN).filter(Number.isFinite);
  if (!times.length) return undefined;
  const start = Math.min(...times);
  return { start, end: Math.max(start + 60_000, ...times) };
}

export function timelinePosition(timestamp: string | undefined, range?: TimelineRange): number | undefined {
  const time = timestamp ? Date.parse(timestamp) : NaN;
  if (!range || !Number.isFinite(time)) return undefined;
  return Math.max(0, Math.min(100, (time - range.start) / (range.end - range.start) * 100));
}

export function timelineTime(percent: number, range?: TimelineRange): string {
  if (!range) {
    const minute = Math.round(580 + percent / 5);
    return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
  }
  const time = new Date(range.start + (range.end - range.start) * percent / 100);
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
}
