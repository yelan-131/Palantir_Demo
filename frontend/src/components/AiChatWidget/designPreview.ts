import { businessDataDesignPath, newBusinessFormDesignPath } from '@/config/navigation';
import type { PageDefinition } from '@/pages/ComponentPages/model';
import type { FlowDesignerConfig } from '@/pages/FormSettings/ProfessionalFlowDesigner';

interface PreviewField {
  name: string;
  label: string;
  type: string;
  options?: unknown;
  required?: boolean;
  proposed?: boolean;
}

interface FormTarget {
  formId?: number;
  formCode?: string;
  fields: PreviewField[];
}

export type DesignPreview = { id: string; title: string } & (
  | ({ kind: 'form' } & FormTarget)
  | ({ kind: 'workflow'; formId: number; design: Partial<FlowDesignerConfig> & Record<string, unknown> } & FormTarget)
  | { kind: 'page'; pageCode?: string; definition: PageDefinition }
);

export function parseDesignPreview(data: Record<string, unknown>): DesignPreview | undefined {
  if (typeof data.id !== 'string' || !/^[0-9a-f]{32}$/.test(data.id) || typeof data.title !== 'string') return;
  const formId = data.formId;
  const hasForm = typeof formId === 'number' && Number.isSafeInteger(formId) && formId > 0;
  if (data.kind === 'form' && (formId === undefined || hasForm) && Array.isArray(data.fields)) {
    return data as unknown as DesignPreview;
  }
  if (data.kind === 'workflow' && hasForm && Array.isArray(data.fields) && data.design && typeof data.design === 'object') {
    return data as unknown as DesignPreview;
  }
  if (data.kind === 'page' && (data.pageCode == null || (typeof data.pageCode === 'string' && /^[\w-]+$/.test(data.pageCode)))
    && data.definition && typeof data.definition === 'object' && Array.isArray((data.definition as PageDefinition).widgets)) {
    return data as unknown as DesignPreview;
  }
}

export function designPreviewPath(preview: DesignPreview): string {
  if (preview.kind === 'page') return preview.pageCode ? `/pages/${encodeURIComponent(preview.pageCode)}` : '/studio/applications';
  if (preview.kind === 'workflow') return businessDataDesignPath(preview.formId, 'flow');
  return preview.formId ? businessDataDesignPath(preview.formId, 'form') : newBusinessFormDesignPath;
}

export function confirmationDesignPreview(
  items: Record<string, unknown>[] | undefined, actionIndex: number, payload: Record<string, unknown> | undefined,
): DesignPreview | undefined {
  const descriptor = items?.find(item => item.id === `workbench-preview-${actionIndex}`)?.payload;
  if (!descriptor || typeof descriptor !== 'object' || !payload) return undefined;
  const preview = parseDesignPreview({ ...descriptor, design: payload.design, definition: payload.definition });
  if (preview?.kind === 'form' && Array.isArray(payload.fields)) {
    const fieldNames = new Map(payload.fields.filter(field => field && typeof field === 'object')
      .map(field => [field.field_name || field.name, field]));
    preview.fields = preview.fields.map(field => {
      const current = field.proposed && fieldNames.get(field.name);
      return current ? { ...field, label: current.label || field.label, required: current.required ?? field.required } : field;
    });
    const form = payload.form as { name?: string } | undefined;
    if (!preview.formId && form?.name) preview.title = form.name;
  }
  return preview;
}
