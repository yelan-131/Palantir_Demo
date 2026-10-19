import { useEffect, useState } from 'react';
import { Select, Spin } from 'antd';
import { getFieldOptions, getFormReferenceOptions } from '@/services/api';

interface Props {
  modelName: string;
  labelField?: string;
  value?: number;
  onChange?: (val: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  formId?: number;
  fieldName?: string;
  contextData?: Record<string, unknown>;
  id?: string;
}

export default function RelationPicker({
  modelName, labelField = 'name', value, onChange, placeholder, disabled, formId, fieldName, contextData, id,
}: Props) {
  const [options, setOptions] = useState<{ label: string; value: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fingerprint = JSON.stringify(contextData || {});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    (formId && fieldName ? getFormReferenceOptions(formId, fieldName, JSON.parse(fingerprint))
      : getFieldOptions(modelName, { label_field: labelField }))
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.data || [];
        setOptions(data.map((d: any) => ({ label: d.label, value: d.id })));
      })
      .catch(() => { if (!cancelled) { setOptions([]); setError('关联档案加载失败，请检查数据来源配置'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [modelName, labelField, formId, fieldName, fingerprint]);

  return (
    <Select
      id={id}
      aria-label={placeholder}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      placeholder={placeholder || `请选择${modelName}`}
      disabled={disabled}
      showSearch
      allowClear
      filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
      status={error ? 'error' : undefined}
      notFoundContent={loading ? <Spin size="small" /> : error || '无数据'}
      style={{ width: '100%' }}
    />
  );
}
