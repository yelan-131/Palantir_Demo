import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { acknowledgePageAction } from '@/services/api';
import { useAiWorkbench } from './context';

export interface FieldProperties {
  label?: string; required?: boolean; readonly?: boolean; placeholder?: string; min?: number; max?: number;
  control_type?: 'text' | 'textarea' | 'code' | 'number' | 'select' | 'datetime' | 'switch' | 'upload';
  width?: 'quarter' | 'third' | 'half' | 'twoThird' | 'threeQuarter' | 'full';
  position?: number; help_text?: string;
  options?: Array<{ label: string; value: string }>;
  settings?: Pick<import('@/utils/formControls').ControlSettings, 'rows' | 'maxLength' | 'precision' | 'unit' | 'displayMode' | 'selectionMode' | 'maxFiles' | 'maxFileSize' | 'fileTypes' | 'checkedText' | 'uncheckedText'>;
  presentation?: import('@/utils/formLayout').ControlPresentation;
  encoding?: { prefix: string; date_pattern: 'YYYYMMDD' | 'YYMMDD' | 'YYYYMM' | 'YYMM'; sequence_length: number; reset_cycle: 'day' | 'month' | 'year' | 'none' };
}
export interface DraftField extends FieldProperties {
  field_name: string; label: string; required: boolean; placeholder: string;
  field_type: 'string' | 'text' | 'integer' | 'decimal' | 'date' | 'datetime' | 'code' | 'enum' | 'attachment' | 'boolean';
}
export interface NewFormDraft {
  name: string; code: string; description: string; fields: DraftField[];
}

export interface PageAction {
  id: string;
  type: 'form_designer';
  form_id: number;
  action: 'draft_new' | 'add_field' | 'review' | 'confirm_draft' | 'open' | 'select_field' | 'set_field_properties' | 'preview';
  draft_id?: string;
  draft?: NewFormDraft;
  field?: NewFormDraft['fields'][number];
  field_name?: string;
  properties?: FieldProperties;
}
export type PageController = (action: PageAction) => Promise<Record<string, unknown>>;

export function AiPageActionRouter() {
  const { pageActions, finishPageAction, getPageController, controllerVersion } = useAiWorkbench();
  const navigate = useNavigate(), location = useLocation();
  const running = useRef(new Set<string>());
  const navigating = useRef(new Set<string>());
  const currentLocation = useRef(location);
  currentLocation.current = location;
  const action = pageActions[0];
  useEffect(() => {
    if (!action) return;
    const timer = window.setTimeout(() => {
      if (!running.current.has(action.id)) {
        const atDesigner = currentLocation.current.pathname === (action.draft_id ? '/form-settings/new' : `/form-settings/${action.form_id}`);
        void acknowledgePageAction(action.id, { ok: false, error: atDesigner ? '设计器尚未加载完成，请稍后重试。' : '未能进入设计器，请重试；如果页面出现未保存修改提示，请先处理该提示。' }).catch(() => undefined);
        navigating.current.delete(action.id);
        finishPageAction(action.id);
      }
    }, 16000);
    return () => window.clearTimeout(timer);
  }, [action?.id, finishPageAction]);
  useEffect(() => {
    if (!action || running.current.has(action.id)) return;
    const targetPath = action.draft_id ? '/form-settings/new' : `/form-settings/${action.form_id}`;
    if (action.action === 'draft_new' && (location.pathname !== targetPath || new URLSearchParams(location.search).get('draft') !== action.draft_id)) {
      // Navigation may suspend while the native designer chunk loads. Repeating
      // it can run into the new editor's own unsaved-change blocker.
      if (!navigating.current.has(action.id)) {
        navigating.current.add(action.id);
        navigate(`${targetPath}?tab=form&legacy=1&draft=${action.draft_id}`, { state: { aiFormDraft: { ...action.draft, id: action.draft_id } } });
      }
      return;
    }
    const controller = getPageController(action.form_id);
    if (!controller) {
      if (!action.draft_id && location.pathname !== targetPath) navigate(`${targetPath}?tab=form&legacy=1`);
      return;
    }
    running.current.add(action.id);
    void (async () => {
      try {
        const state = await controller(action);
        await acknowledgePageAction(action.id, { ok: true, state });
      } catch (error) {
        await acknowledgePageAction(action.id, { ok: false, error: error instanceof Error ? error.message : '页面操作失败' }).catch(() => undefined);
      } finally {
        running.current.delete(action.id);
        navigating.current.delete(action.id);
        finishPageAction(action.id);
      }
    })();
  }, [action, location.pathname, location.search, controllerVersion, getPageController, finishPageAction, navigate]);
  return null;
}
