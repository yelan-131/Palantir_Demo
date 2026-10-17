import { useCallback } from 'react';
import { notification } from 'antd';

export default function useAISettingsNotification() {
  const [api, contextHolder] = notification.useNotification({ placement: 'topRight', top: 76, duration: 7 });
  const notify = useCallback((type: 'success' | 'error' | 'warning', title: string, description?: string) => {
    api[type]({ message: title, description, className: 'ai-settings-notice', role: 'status' });
  }, [api]);
  return { notify, contextHolder };
}
