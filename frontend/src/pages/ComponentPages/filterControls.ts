import {controlTypeForField, defaultOperatorForControl, type ViewFilterConfig} from '@/utils/viewConfig';
import type {ControlSettings} from '@/utils/formControls';

export interface FilterField {
  field_name:string;label:string;field_type:string;controlType?:string;typeSettings?:ControlSettings;
  relation_config?:string;enum_values?:unknown;placeholder?:string;
}
/** Field UI metadata takes precedence over its database storage type. */
export function sourceFilterConfig(field:FilterField, index:number, existing?:ViewFilterConfig):ViewFilterConfig {
  const type=field.controlType;
  const controlType=type==='relation'||field.relation_config?'relation':
    type==='select'||type==='switch'||field.field_type==='boolean'?'select':
    type==='datetime'||type==='date'||['date','datetime','timestamp'].includes(field.field_type)?(field.typeSettings?.dateMode==='range'?'dateRange':'date'):
    type==='number'?'number':controlTypeForField(field.field_type);
  return {id:existing?.id??`component-filter-${field.field_name}`,fieldName:field.field_name,label:field.label,
    controlType,operator:controlType==='select'&&(field.typeSettings?.selectionMode==='multiple'||field.typeSettings?.displayMode==='tags')?'in':defaultOperatorForControl(controlType),enabled:true,advanced:false,sortOrder:index,
    placeholder:field.placeholder,defaultValue:existing?.defaultValue};
}
