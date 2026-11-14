import { useCallback, useEffect, useRef, useState } from 'react';
import { Form, type FormInstance } from 'antd';

export function settingsSnapshot(value: unknown): string {
  return JSON.stringify(value, (_, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
    }
    return item;
  });
}

/** Keep the values and edit token that the user actually started editing. */
export default function useSettingsDraft(form: FormInstance, key: string, values: Record<string, unknown>, token?: string, unsaved = false) {
  const watched = Form.useWatch([], { form, preserve: true });
  const [baseline, setBaseline] = useState<{ key: string; values: Record<string, unknown>; token?: string; unsaved: boolean }>();
  const baselineRef = useRef(baseline);
  const dirtyRef = useRef(false);
  const dirty = Boolean(baseline && (baseline.unsaved || settingsSnapshot(watched ?? form.getFieldsValue(true)) !== settingsSnapshot(baseline.values)));
  dirtyRef.current = dirty;
  const signature = settingsSnapshot(values);

  const accept = useCallback((nextKey: string, nextValues: Record<string, unknown>, nextToken?: string, nextUnsaved = false) => {
    form.resetFields();
    form.setFieldsValue(nextValues);
    const next = { key: nextKey, values: form.getFieldsValue(true), token: nextToken, unsaved: nextUnsaved };
    baselineRef.current = next;
    dirtyRef.current = false;
    setBaseline(next);
  }, [form]);

  useEffect(() => {
    if (baselineRef.current?.key === key && dirtyRef.current) return;
    accept(key, JSON.parse(signature), token, unsaved);
  }, [key, signature, token, unsaved, accept]);

  const discard = () => {
    const current = baselineRef.current;
    if (current) accept(current.key, current.values, current.token);
  };
  const isDirty = () => Boolean(baselineRef.current &&
    (baselineRef.current.unsaved || settingsSnapshot(form.getFieldsValue(true)) !== settingsSnapshot(baselineRef.current.values)));
  return { dirty, isDirty, accept, discard, token: () => baselineRef.current?.token };
}
