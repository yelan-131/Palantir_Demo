import { useState, useCallback } from 'react';
import { message } from 'antd';

/**
 * Reusable hook for API calls with unified loading/error handling.
 *
 * Usage:
 *   const { loading, execute } = useApi(api.getOverview, { errorMsg: '加载失败' });
 *   useEffect(() => { execute(); }, []);
 *
 * Or with inline calls:
 *   const { loading, run } = useApi();
 *   const data = await run(() => api.getOverview());
 */
export function useApi<T = unknown>() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <R = T>(
    fn: () => Promise<{ data: R }>,
    opts?: { errorMsg?: string; onSuccess?: (data: R) => void },
  ): Promise<R | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fn();
      const d = res.data as R;
      setData(d as unknown as T);
      opts?.onSuccess?.(d);
      return d;
    } catch (e: unknown) {
      const msg = opts?.errorMsg ?? '请求失败';
      setError(msg);
      message.error(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, data, error, run, setData };
}
