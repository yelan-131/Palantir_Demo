export interface OptionSearchFilter { id: string; field: string; operator: 'eq' | 'ne' | 'isEmpty' | 'notEmpty'; source: 'fixed' | 'field'; value?: string; sourceField?: string }
export interface OptionSearchSettings { fields?: string[]; match?: 'contains' | 'prefix' | 'exact'; filters?: OptionSearchFilter[] }
export function matchesOptionSearch(value: unknown, keyword: string, mode: OptionSearchSettings['match'] = 'contains'): boolean {
  const text = String(value ?? '').toLocaleLowerCase(), query = keyword.toLocaleLowerCase();
  return mode === 'exact' ? text === query : mode === 'prefix' ? text.startsWith(query) : text.includes(query);
}
export interface ControlSettings {
  search?: OptionSearchSettings;
  minLength?: number; maxLength?: number; textFormat?: string; trimMode?: string; caseMode?: string; rows?: number;
  min?: number; max?: number; precision?: number; unit?: string; thousandSeparator?: boolean;
  selectionMode?: string; displayMode?: string; allowClear?: boolean; allowCreateOption?: boolean;
  minSelections?: number; maxSelections?: number; tagCollapse?: 'none' | 'responsive' | 'fixed'; maxVisibleTags?: number;
  dateMode?: string; defaultDate?: string; disablePast?: boolean;
  maxFiles?: number; maxFileSize?: number; fileTypes?: string; defaultChecked?: boolean; checkedText?: string; uncheckedText?: string;
  allowAdd?: boolean; allowDelete?: boolean; minRows?: number; maxRows?: number;
  columns?: { key: string; label: string; type: 'string' | 'number' | 'boolean'; required?: boolean }[];
  sourceFormId?: number;
}
/** Accept persisted enums, legacy maps, JSON strings and labelled options. */
export function enumOptions(raw: unknown): { label: string; value: string | number }[] {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return []; } }
  if (!raw || typeof raw !== 'object') return [];
  const values = Array.isArray(raw) ? raw : (raw as any).values ?? raw;
  if (Array.isArray(values)) return values.flatMap(item => {
    if (['string', 'number'].includes(typeof item)) return [{ label: String(item), value: item }];
    if (item && typeof item === 'object' && (typeof item.value === 'string' || typeof item.value === 'number')) return [{ label: String(item.label ?? item.value), value: item.value }];
    return [];
  });
  return values && typeof values === 'object' ? Object.entries(values).filter(([key, value]) => !['source','custom'].includes(key) && ['string','number'].includes(typeof value)).map(([value,label]) => ({value,label:String(label)})) : [];
}
export function normalizeText(value: string, settings: ControlSettings): string {
  const trimmed = settings.trimMode === 'trim' ? value.trim() : ['removeAll','trimAll'].includes(settings.trimMode || '') ? value.replace(/\s/g,'') : value;
  return settings.caseMode === 'upper' ? trimmed.toUpperCase() : settings.caseMode === 'lower' ? trimmed.toLowerCase() : trimmed;
}
export function fileAccept(value = ''): string {
  const groups: Record<string,string> = { '图片':'.png,.jpg,.jpeg,.gif,.webp', 'PDF':'.pdf', 'Office':'.doc,.docx,.xls,.xlsx,.ppt,.pptx', '日志文件':'.log,.txt' };
  return value.split(/[,，、;；\s]+/).filter(Boolean).map(item => groups[item] || (item.startsWith('.') || item.includes('/') ? item : `.${item}`)).join(',');
}
export function duplicateFieldBindings(controls: {fieldKey?:string;name?:string}[]): string[] {
  const counts=new Map<string,number>();for(const c of controls) if(c.fieldKey) counts.set(c.fieldKey,(counts.get(c.fieldKey)||0)+1);
  return [...counts].filter(([,count])=>count>1).map(([name])=>name);
}
