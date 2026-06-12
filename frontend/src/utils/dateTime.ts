export function parseServerDate(value?: string | number | Date | null): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = /T/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)
    ? `${raw}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatServerDateTime(value?: string | number | Date | null, fallback = '-') {
  const date = parseServerDate(value);
  if (!date) return fallback;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function formatServerShortDateTime(value?: string | number | Date | null, fallback = '-') {
  const date = parseServerDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatServerTime(value?: string | number | Date | null, fallback = '-') {
  const date = parseServerDate(value);
  if (!date) return fallback;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
