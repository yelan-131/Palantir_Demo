import { cloneElement, createContext, useContext, type ReactElement } from 'react';
import { Form, type FormItemProps } from 'antd';

export const RegistryReadOnly = createContext(false);

function RegistryValue({ control, value, checked, id, format, ...controlProps }: {
  control: ReactElement<{
    options?: { label: string; value: string }[];
    value?: unknown;
    checked?: boolean;
    id?: string;
    onChange?: (...args: unknown[]) => void;
  }>;
  value?: string | string[];
  checked?: boolean;
  id?: string;
  onChange?: (...args: unknown[]) => void;
  format?: 'code' | 'json' | 'description';
}) {
  const readOnly = useContext(RegistryReadOnly);
  if (!readOnly) {
    return cloneElement(control, {
      ...controlProps, id, ...(checked === undefined ? { value } : { checked }),
    });
  }
  const label = (item: string) => control.props.options?.find(option => option.value === item)?.label ?? item;
  const display = checked !== undefined ? (checked ? '是' : '否')
    : Array.isArray(value) ? value.map(label).join('、') : value && label(value);
  if (format === 'json') return <pre id={id} className="ai-registry-value ai-registry-json">{display || '—'}</pre>;
  return <div id={id} className={`ai-registry-value${format === 'description' ? ' ai-registry-description' : ''}`}>
    {format === 'code' ? <code>{display || '—'}</code> : display || '—'}
  </div>;
}

export default function RegistryField({ children, format, ...props }: FormItemProps & {
  children: Parameters<typeof RegistryValue>[0]['control'];
  format?: 'code' | 'json' | 'description';
}) {
  const readOnly = useContext(RegistryReadOnly);
  return <Form.Item {...props} required={readOnly ? false : props.required}>
    <RegistryValue control={children} format={format} />
  </Form.Item>;
}
