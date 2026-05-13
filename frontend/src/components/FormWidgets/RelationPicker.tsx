import { useEffect, useState } from 'react';
import { Select, Spin } from 'antd';
import { getFieldOptions } from '@/services/api';

interface Props {
  modelName: string;
  labelField?: string;
  value?: number;
  onChange?: (val: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function RelationPicker({
  modelName, labelField = 'name', value, onChange, placeholder, disabled,
}: Props) {
  const [options, setOptions] = useState<{ label: string; value: number }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFieldOptions(modelName, { label_field: labelField })
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.data || [];
        setOptions(data.map((d: any) => ({ label: d.label, value: d.id })));
      })
      .catch(() => { if (!cancelled) setOptions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [modelName, labelField]);

  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      placeholder={placeholder || `请选择${modelName}`}
      disabled={disabled}
      showSearch
      allowClear
      filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
      notFoundContent={loading ? <Spin size="small" /> : '无数据'}
      style={{ width: '100%' }}
    />
  );
}
