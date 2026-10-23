import FieldProtection, {type FieldPolicy} from '@/components/FieldProtection';
import { useEffect, useState } from 'react';
import { Select, Spin } from 'antd';
import { getFieldOptions, getFormReferenceOptions, previewFormReferenceOptions, type OptionSearchRequest } from '@/services/api';

interface Props extends FieldPolicy {
  allowClear?: boolean; showSearch?: boolean; modelName: string; labelField?: string;
  value?: number|string; onChange?: (val: number | string | undefined) => void;
  placeholder?: string; disabled?: boolean; draftControls?: unknown[];
  formId?: number; fieldName?: string; contextData?: Record<string, unknown>; id?: string;
}
type Option = { label: string; value: number|string };
export default function RelationPicker({allowClear=true, showSearch=true, copyMode, copyText, modelName, labelField='name', value, onChange, placeholder, disabled, formId, fieldName, contextData, draftControls, id}: Props) {
  const [options,setOptions]=useState<Option[]>([]), [selectedOption,setSelectedOption]=useState<Option>();
  const [loading,setLoading]=useState(false), [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [input,setInput]=useState(''), [query,setQuery]=useState(''), [page,setPage]=useState(1), [hasMore,setHasMore]=useState(false);
  const fingerprint=JSON.stringify(contextData||{}), draftFingerprint=JSON.stringify(draftControls);
  const remote=Boolean(formId&&fieldName);
  const request=(search:OptionSearchRequest)=>draftControls
    ? previewFormReferenceOptions(formId!,fieldName!,JSON.parse(draftFingerprint!),JSON.parse(fingerprint),search)
    : getFormReferenceOptions(formId!,fieldName!,JSON.parse(fingerprint),search);
  useEffect(()=>{const timer=setTimeout(()=>{setQuery(input);setPage(1);},250);return()=>clearTimeout(timer);},[input]);
  useEffect(()=>{setPage(1);setOptions([]);},[fingerprint,draftFingerprint,modelName,labelField,formId,fieldName]);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');
    (remote?request({query,page,page_size:20}):getFieldOptions(modelName,{label_field:labelField})).then(res=>{
      if(cancelled)return;
      const next=(res.data?.data||[]).map((item:any)=>({label:item.label,value:item.id}));
      setOptions(current=>{const merged=page===1?next:[...current,...next];return [...new Map(merged.map((item:Option)=>[String(item.value),item])).values()] as Option[];});
      setHasMore(Boolean(res.data?.has_more));
    }).catch(()=>{if(!cancelled){setError('选项加载失败，请重试或检查数据来源与搜索条件');setHasMore(false);if(page===1)setOptions([]);}}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[query,page,fingerprint,draftFingerprint,modelName,labelField,formId,fieldName,retry]);
  // Resolve the current selection separately: it may be outside the first page
  // or absent from the current keyword results. This call applies the same scope.
  useEffect(()=>{
    let cancelled=false;setSelectedOption(undefined);
    if(remote&&value!=null)void request({selected:value,page:1,page_size:1}).then(res=>{
      const item=res.data?.data?.[0];if(!cancelled&&item)setSelectedOption({label:item.label,value:item.id});
    }).catch(()=>{});
    return()=>{cancelled=true;};
  },[value,fingerprint,draftFingerprint,formId,fieldName]);
  const displayed=selectedOption&&!options.some(item=>String(item.value)===String(selectedOption.value))?[selectedOption,...options]:options;
  return <FieldProtection copyMode={copyMode} copyText={copyText}><Select
    id={id} aria-label={placeholder} value={value==null?undefined:displayed.find(item=>String(item.value)===String(value))?.value??value}
    onChange={onChange} options={displayed} loading={loading} placeholder={placeholder||`请选择${modelName}`} disabled={disabled}
    showSearch={showSearch} allowClear={allowClear} onSearch={remote?setInput:undefined}
    filterOption={remote?false:(input,option)=>(option?.label??'').toLowerCase().includes(input.toLowerCase())}
    onOpenChange={open=>{if(open&&error){setError('');setPage(1);setRetry(current=>current+1);setInput('');}if(!open)setInput('');}}
    onPopupScroll={event=>{const target=event.currentTarget;if(remote&&hasMore&&!loading&&target.scrollHeight-target.scrollTop-target.clientHeight<40)setPage(current=>current+1);}}
    status={error?'error':undefined} notFoundContent={loading?<Spin size="small"/>:error||'没有符合搜索条件的选项'} style={{width:'100%'}}
  /></FieldProtection>;
}
