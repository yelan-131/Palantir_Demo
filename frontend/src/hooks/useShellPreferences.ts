import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';

export interface ShellPreferences {
  density: 'compact' | 'standard' | 'relaxed';
  sidebar: 'expanded' | 'collapsed';
  aiBubbleVisible: boolean;
  appOverrides: Record<string, { label?: string; icon?: string; pinned?: boolean }>;
  home: string;
  language: string;
  theme: string;
}

const CHANGE_EVENT = 'mf-shell-preferences-change';
const LEGACY_KEY = 'mf_user_preferences';
// Unsaved changes must survive subsequent updates and component remounts in this
// window when browser storage is disabled or full. Keys retain account isolation.
const unsavedPreferences = new Map<string, ShellPreferences>();
const cachedPreferences = new Map<string, ShellPreferences>();
const defaults: ShellPreferences = {
  density: 'standard',
  sidebar: 'expanded',
  aiBubbleVisible: true,
  appOverrides: {},
  home: 'workspace',
  language: 'zh-CN',
  theme: 'tech-white',
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalize(value: unknown): ShellPreferences {
  const input = record(value);
  const appOverrides: ShellPreferences['appOverrides'] = {};
  for (const [key, raw] of Object.entries(record(input.appOverrides)).slice(0, 100)) {
    if (!/^(?:[a-zA-Z][a-zA-Z0-9_-]{0,63}|app:[a-zA-Z0-9_-]{1,64})$/.test(key)
      || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const item = record(raw);
    const override: ShellPreferences['appOverrides'][string] = {};
    if (typeof item.label === 'string') {
      const label = item.label.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 32);
      if (label && !/\b(?:https?|data|javascript):/i.test(label)) override.label = label;
    }
    if (typeof item.icon === 'string') {
      const icon = item.icon.trim();
      // Only icon names or a single emoji; never persist image URLs or executable content.
      if (/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(icon)
        || /^(?:\p{Extended_Pictographic}\uFE0F?)(?:\u200D\p{Extended_Pictographic}\uFE0F?)*$/u.test(icon)) {
        override.icon = icon;
      }
    }
    if (typeof item.pinned === 'boolean') override.pinned = item.pinned;
    if (Object.keys(override).length) appOverrides[key] = override;
  }
  return {
    density: ['compact', 'standard', 'relaxed'].includes(String(input.density))
      ? input.density as ShellPreferences['density'] : defaults.density,
    sidebar: input.sidebar === 'collapsed' ? 'collapsed' : 'expanded',
    aiBubbleVisible: typeof input.aiBubbleVisible === 'boolean' ? input.aiBubbleVisible : true,
    appOverrides,
    home: ['workspace', 'current-app', 'system-admin'].includes(String(input.home))
      ? String(input.home) : defaults.home,
    language: input.language === 'en-US' ? 'en-US' : 'zh-CN',
    theme: 'tech-white',
  };
}

function parseStorage(key: string): Record<string, unknown> {
  try {
    return record(JSON.parse(window.localStorage.getItem(key) || '{}'));
  } catch {
    return {};
  }
}

function readPreferences(key: string): ShellPreferences {
  const unsaved = unsavedPreferences.get(key);
  if (unsaved) return unsaved;
  try {
    window.localStorage.getItem(key);
  } catch {
    return cachedPreferences.get(key) ?? normalize({});
  }
  // Migrate only the old UI fields, excluding any unrelated data or credentials.
  const legacy = parseStorage(LEGACY_KEY);
  const preferences = normalize({
    density: legacy.density,
    sidebar: legacy.sidebar,
    home: legacy.home,
    language: legacy.language,
    ...parseStorage(key),
  });
  cachedPreferences.set(key, preferences);
  return preferences;
}

export function useShellPreferences() {
  const userId = useAuthStore((state) => state.user?.id);
  const tenantId = useAuthStore((state) => state.user?.tenant_id);
  const key = `mf_shell_preferences_${tenantId ?? 'default'}:${userId ?? 'anonymous'}`;
  const [snapshot, setSnapshot] = useState(() => ({ key, preferences: readPreferences(key) }));
  const preferences = snapshot.key === key ? snapshot.preferences : readPreferences(key);

  useEffect(() => {
    const refresh = () => setSnapshot({ key, preferences: readPreferences(key) });
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) unsavedPreferences.delete(key);
      if (event.key === key || event.key === LEGACY_KEY || event.key === null) refresh();
    };
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; preferences: ShellPreferences }>).detail;
      if (detail?.key === key) setSnapshot({ key, preferences: normalize(detail.preferences) });
    };
    refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, onChange);
    };
  }, [key]);

  const updatePreferences = useCallback((updates: Partial<ShellPreferences>) => {
    const next = normalize({ ...readPreferences(key), ...updates });
    cachedPreferences.set(key, next);
    let persisted = true;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      unsavedPreferences.delete(key);
    } catch {
      persisted = false;
      // Continue applying preferences in this window if storage is unavailable.
      unsavedPreferences.set(key, next);
    }
    setSnapshot({ key, preferences: next });
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, preferences: next } }));
    return { persisted, preferences: next };
  }, [key]);

  return { preferences, updatePreferences, persisted: !unsavedPreferences.has(key) };
}
