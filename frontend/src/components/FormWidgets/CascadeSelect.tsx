import { useEffect, useState } from 'react';
import { Select, Spin } from 'antd';
import { getFieldOptions } from '@/services/api';

interface CascadeLevel {
  modelName: string;
  labelField?: string;
  cascadeFrom: string;
  placeholder?: string;
}

interface Props {
  levels: CascadeLevel[];
  values: Record<string, number | undefined>;
  onChange: (field: string, value: number | undefined) => void;
  disabled?: boolean;
}

export default function CascadeSelect({ levels, values, onChange, disabled }: Props) {
  const [optionsMap, setOptionsMap] = useState<Record<string, { label: string; value: number }[]>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        const key = `${level.modelName}-${level.cascadeFrom}`;

        if (i === 0) {
          if (optionsMap[key]) continue;
          setLoadingMap((prev) => ({ ...prev, [key]: true }));
          try {
            const res = await getFieldOptions(level.modelName, { label_field: level.labelField || 'name' });
            if (cancelled) return;
            const data = res.data?.data || [];
            setOptionsMap((prev) => ({
              ...prev,
              [key]: data.map((d: any) => ({ label: d.label, value: d.id })),
            }));
          } finally {
            if (!cancelled) setLoadingMap((prev) => ({ ...prev, [key]: false }));
          }
        } else {
          const prevLevel = levels[i - 1];
          const cascadeValue = values[prevLevel.cascadeFrom];
          if (!cascadeValue) {
            setOptionsMap((prev) => ({ ...prev, [key]: [] }));
            continue;
          }
          setLoadingMap((prev) => ({ ...prev, [key]: true }));
          try {
            const res = await getFieldOptions(level.modelName, {
              label_field: level.labelField || 'name',
              cascade_from: level.cascadeFrom,
              cascade_value: cascadeValue,
            });
            if (cancelled) return;
            const data = res.data?.data || [];
            setOptionsMap((prev) => ({
              ...prev,
              [key]: data.map((d: any) => ({ label: d.label, value: d.id })),
            }));
          } finally {
            if (!cancelled) setLoadingMap((prev) => ({ ...prev, [key]: false }));
          }
        }
      }
    }

    loadOptions();
    return () => { cancelled = true; };
  }, [levels, values]);

  return (
    <>
      {levels.map((level, i) => {
        const key = `${level.modelName}-${level.cascadeFrom}`;
        const opts = optionsMap[key] || [];
        const loading = loadingMap[key] || false;
        const prevLevel = i > 0 ? levels[i - 1] : null;
        const parentValue = prevLevel ? values[prevLevel.cascadeFrom] : undefined;
        const isDisabled = disabled || (i > 0 && !parentValue);

        return (
          <Select
            key={key}
            value={values[level.cascadeFrom]}
            onChange={(val) => {
              onChange(level.cascadeFrom, val);
              for (let j = i + 1; j < levels.length; j++) {
                onChange(levels[j].cascadeFrom, undefined);
              }
            }}
            options={opts}
            loading={loading}
            placeholder={level.placeholder || `请选择${level.modelName}`}
            disabled={isDisabled}
            showSearch
            allowClear
            filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            notFoundContent={loading ? <Spin size="small" /> : '无数据'}
            style={{ width: '100%', marginBottom: 8 }}
          />
        );
      })}
    </>
  );
}
