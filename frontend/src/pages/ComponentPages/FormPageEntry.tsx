import React, {lazy, Suspense, useEffect, useState} from 'react';
import {Alert, Empty, Spin} from 'antd';
import {useLocation, useParams, useSearchParams} from 'react-router-dom';
import api from '@/services/api';
import {useAuthStore} from '@/stores/authStore';

const ComponentPages = lazy(() => import('./index'));
const DynamicPage = lazy(() => import('../DynamicPage'));
const AppProgramPage = lazy(() => import('../AppPrograms'));
const AlertCenter = lazy(() => import('../AlertCenter'));

/** Existing form routes resolve their own page; no third creation entry is needed. */
export default function FormPageEntry({kind, formSlug, businessDataDesign = false}: {kind: 'business' | 'program'; formSlug?:string; businessDataDesign?: boolean}) {
  const params = useParams<{slug: string; programId: string}>();
  const slug = formSlug || params.slug || params.programId || '';
  return <BoundFormPage key={`${kind}:${slug}:${businessDataDesign}`} kind={kind} slug={slug} businessDataDesign={businessDataDesign} />;
}

function BoundFormPage({kind, slug, businessDataDesign}: {kind: 'business' | 'program'; slug: string; businessDataDesign: boolean}) {
  const [searchParams] = useSearchParams();
  const {key: navigationKey} = useLocation();
  const admin = Boolean(useAuthStore(state => state.user?.is_admin));
  const openEditor = admin && (businessDataDesign || searchParams.get('edit') === '1');
  const tab = searchParams.get('tab');
  const designTab = openEditor && businessDataDesign && (tab === 'form' || tab === 'flow' || tab === 'data' || tab === 'style') ? tab : undefined;
  const [binding, setBinding] = useState<{enabled: boolean; code?: string; form?: {id: number}}>();
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setBinding(undefined); setError('');
    (async () => {
      try {
        const response = await api.get(`/pages/forms/${encodeURIComponent(slug)}/binding`);
        let value = response.data;
        if (value.enabled && !value.code && admin) {
          const created = await api.post(`/pages/forms/${value.form.id}/binding`, {blank: !businessDataDesign, populate: true});
          value = {...value, code: created.data.code};
        }
        if (current) setBinding(value);
      } catch (failure) {
        if (current) setError((failure as {response?: {data?: {detail?: string}}})?.response?.data?.detail || '表单页面加载失败');
      }
    })();
    return () => {current = false;};
  }, [slug, admin, businessDataDesign]);
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!binding) return <div style={{padding: 80, textAlign: 'center'}}><Spin /></div>;
  if (businessDataDesign && (!binding.code || !binding.form)) return <Empty description="找不到此业务数据对应的页面" />;
  return <Suspense fallback={<Spin />}>
    {binding.enabled ? binding.code ? <ComponentPages pageCode={binding.code} openEditor={openEditor} recordFormId={binding.form?.id} businessDataFormId={businessDataDesign ? binding.form?.id : undefined} designTab={designTab} designNavigationKey={navigationKey} /> : <Empty description="此表单的页面尚未发布" />
      : slug === 'alert-center' ? <AlertCenter /> : kind === 'business' ? <DynamicPage /> : <AppProgramPage />}
  </Suspense>;
}
