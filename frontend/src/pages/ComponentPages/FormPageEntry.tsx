import React, {lazy, Suspense, useEffect, useState} from 'react';
import {Alert, Empty, Spin} from 'antd';
import {useParams, useSearchParams} from 'react-router-dom';
import api from '@/services/api';
import {useAuthStore} from '@/stores/authStore';

const ComponentPages = lazy(() => import('./index'));
const DynamicPage = lazy(() => import('../DynamicPage'));
const AppProgramPage = lazy(() => import('../AppPrograms'));

/** Existing form routes resolve their own page; no third creation entry is needed. */
export default function FormPageEntry({kind}: {kind: 'business' | 'program'}) {
  const params = useParams<{slug: string; programId: string}>();
  const [searchParams] = useSearchParams();
  const slug = params.slug || params.programId;
  const admin = Boolean(useAuthStore(state => state.user?.is_admin));
  const [binding, setBinding] = useState<{enabled: boolean; code?: string; form?: {id: number}}>();
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setBinding(undefined); setError('');
    (async () => {
      try {
        const response = await api.get(`/pages/forms/${encodeURIComponent(slug || '')}/binding`);
        let value = response.data;
        if (value.enabled && !value.code && admin) {
          const created = await api.post(`/pages/forms/${value.form.id}/binding`);
          value = {...value, code: created.data.code};
        }
        if (current) setBinding(value);
      } catch (failure) {
        if (current) setError((failure as {response?: {data?: {detail?: string}}})?.response?.data?.detail || '表单页面加载失败');
      }
    })();
    return () => {current = false;};
  }, [slug, admin]);
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!binding) return <div style={{padding: 80, textAlign: 'center'}}><Spin /></div>;
  return <Suspense fallback={<Spin />}>
    {searchParams.get('view') === 'records' && binding.form?.id ? <DynamicPage formSlug={String(binding.form.id)} /> : binding.enabled ? binding.code ? <ComponentPages pageCode={binding.code} /> : <Empty description="此表单的页面尚未发布" />
      : kind === 'business' ? <DynamicPage /> : <AppProgramPage />}
  </Suspense>;
}
