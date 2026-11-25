import dayjs from 'dayjs';
import {controlTypeForField, defaultOperatorForControl, type ViewFilterConfig} from '@/utils/viewConfig';
import {RECORD_METADATA_FIELDS, isRecordMetadataField, type FilterControlMode} from './businessComponents';
import type {ControlSettings} from '@/utils/formControls';

export interface FilterField {
  field_name:string;label:string;field_type:string;controlType?:string;typeSettings?:ControlSettings;
  relation_config?:string;enum_values?:unknown;placeholder?:string;
}

export interface StructuredFilter {
  field: string;
  op: string;
  value: unknown;
  endExclusive?: boolean;
}

export function recordMetadataFilterConfig(name: string, index: number): ViewFilterConfig | undefined {
  const field=RECORD_METADATA_FIELDS.find(item=>item.fieldName===name);
  if (!field) return undefined;
  const {fieldName,label,controlType,operator}=field;
  return {id:`component-filter-${fieldName}`,fieldName,label,controlType,operator,enabled:true,advanced:false,sortOrder:index};
}

const controlLabels: Record<ViewFilterConfig['controlType'], string> = {
  keyword: '关键词', text: '文本输入', select: '下拉单选', dateRange: '日期范围',
  date: '日期选择', number: '数字输入', relation: '关联选择',
};

export function sourceFilterControlLabel(filter: ViewFilterConfig): string {
  return filter.controlType==='select'&&filter.operator==='in' ? '下拉多选' : controlLabels[filter.controlType];
}

export function filterValueToPayload(filter: ViewFilterConfig, value: unknown): StructuredFilter | null {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (filter.controlType === 'dateRange' && Array.isArray(value)) {
    const [start,end]=value;
    if (isRecordMetadataField(filter.fieldName)) {
      const firstDay=start ? dayjs(start) : null;
      const lastDay=end ? dayjs(end) : null;
      if ((!firstDay&&!lastDay) || (firstDay&&!firstDay.isValid()) || (lastDay&&!lastDay.isValid())) return null;
      return {
        field: filter.fieldName,
        op: 'between',
        value: [firstDay?.startOf('day').toISOString() ?? null,lastDay?.add(1,'day').startOf('day').toISOString() ?? null],
        endExclusive: true,
      };
    }
    return {
      field: filter.fieldName,
      op: filter.operator || 'between',
      value: [dayjs.isDayjs(start) ? start.format('YYYY-MM-DD') : start, dayjs.isDayjs(end) ? end.format('YYYY-MM-DD') : end],
    };
  }
  if (filter.operator === 'in') return {field:filter.fieldName, op:'in', value:Array.isArray(value)?value:[value]};
  return {field:filter.fieldName, op:filter.operator, value:dayjs.isDayjs(value)?value.format(filter.controlType==='date'?'YYYY-MM-DD':'YYYY-MM-DDTHH:mm:ss'):value};
}
/** Field UI metadata takes precedence over its database storage type. */
export function sourceFilterConfig(field:FilterField, index:number, existing?:ViewFilterConfig, mode?:FilterControlMode):ViewFilterConfig {
  const type=field.controlType;
  const controlType=type==='relation'||field.relation_config?'relation':
    type==='select'||type==='switch'||field.field_type==='boolean'?'select':
    type==='datetime'||type==='date'||['date','datetime','timestamp'].includes(field.field_type)?(field.typeSettings?.dateMode==='range'?'dateRange':'date'):
    type==='number'?'number':controlTypeForField(field.field_type);
  const sourceMultiple=field.typeSettings?.selectionMode==='multiple'||field.typeSettings?.displayMode==='tags';
  const multiple=mode==='multi-dropdown'||mode==='checkbox';
  const override=Boolean(mode&&controlType==='select'&&type!=='switch'&&field.field_type!=='boolean');
  let defaultValue=existing?.defaultValue;
  if(override){
    if(multiple)defaultValue=defaultValue==null||defaultValue===''?undefined:Array.isArray(defaultValue)?defaultValue:[defaultValue];
    else if(Array.isArray(defaultValue))defaultValue=defaultValue.length===1?defaultValue[0]:undefined;
  }
  return {id:existing?.id??`component-filter-${field.field_name}`,fieldName:field.field_name,label:field.label,
    controlType,operator:controlType==='select'&&(sourceMultiple||(override&&multiple))?'in':defaultOperatorForControl(controlType),enabled:true,advanced:false,sortOrder:index,
    placeholder:field.placeholder,defaultValue};
}
