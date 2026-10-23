"""Published field presentation policies. Raw storage is never replaced by a mask."""
import ast
import json
from fastapi import HTTPException
from sqlalchemy import select
from app.api.deps import current_tenant_id,current_user_id
from app.services.form_rules import control_rule,config


def strategy(rule,default):
    return (rule.get('conditions') or {}).get('strategy') or default


def partial_mask(value,start=1,end=1):
    if value in (None,''): return value
    text=str(value);start=max(0,min(int(start),20));end=max(0,min(int(end),20))
    if len(text)<=start+end: return '*'*max(4,len(text))
    return text[:start]+'*'*max(4,len(text)-start-end)+(text[-end:] if end else '')


async def presentation(db,user,fields,data,*,cache=None):
    """Return safe display values and executable copy policy, including for admins."""
    cache=cache if cache is not None else {};masked={};result={};out=dict(data)
    for field in fields:
        name=field.field_name;rules=config(field).get('rules') or {};rule=rules.get('masked') or {}
        active=control_rule(rule,data,False)
        mode=strategy(rule,'role');settings=rule.get('conditions') or {}
        if active and mode=='role':
            if 'presentation_roles' not in cache:
                from app.models.relational import UserRole
                cache['presentation_roles']=set((await db.scalars(select(UserRole.role_id).where(UserRole.tenant_id==current_tenant_id(user),UserRole.user_id==current_user_id(user)))).all()) if db is not None else set()
            active=not bool(cache['presentation_roles']&set(settings.get('roleIds') or []))
        masked[name]=active
        if active:
            out[name]='••••••' if mode=='hidden' else partial_mask(data.get(name),settings.get('keepStart',1),settings.get('keepEnd',1))
        copy_rule=rules.get('copyable')
        copy_mode=strategy(copy_rule,'normal') if copy_rule and control_rule(copy_rule,data,True) else 'disabled' if copy_rule else 'normal'
        result[name]={'masked':active,'copyMode':copy_mode}
        if copy_mode=='maskedCopy':result[name]['copyText']=partial_mask(out.get(name))
    from app.services.designer_permissions import field_settings
    extras=await field_settings(db,user,fields,cache=cache)
    for name,extra in extras.items():
        if extra.get('masked') and not masked.get(name):out[name]=partial_mask(data.get(name));masked[name]=True;result[name]['masked']=True
        if extra.get('hidden'):
            out.pop(name,None);masked[name]=True;result[name].update(masked=True,visible=False)
    # Calculated derivatives cannot serve as an alternate plaintext channel.
    changed=True
    while changed:
        changed=False
        for field in fields:
            if masked.get(field.field_name):continue
            dependencies=set()
            expression=(config(field).get('computed') or {}).get('expression')
            if expression:
                try: dependencies={node.id for node in ast.walk(ast.parse(expression,mode='eval')) if isinstance(node,ast.Name)}
                except (SyntaxError,TypeError):pass
            for source in fields:
                ref=config(source).get('relation_config') or {}
                if isinstance(ref,str):
                    try:ref=json.loads(ref)
                    except (ValueError,TypeError):ref={}
                if field.field_name in (ref.get('backfill') or {}) or any(item.get('targetField')==field.field_name for item in config(source).get('assignmentRules') or []):dependencies.add(source.field_name)
            if any(masked.get(key) for key in dependencies):
                name=field.field_name;masked[name]=True;out[name]='••••••';result[name].update(masked=True,copyText='••••••');changed=True
    for name,policy in result.items():
        if policy.get('copyMode')=='maskedCopy':policy['copyText']=partial_mask(out.get(name)) if policy.get('visible') is not False else ''
    return out,result


async def protect_update(db,user,fields,incoming,existing):
    if existing is None:return
    _,policies=await presentation(db,user,fields,existing)
    denied=[field.label for field in fields if policies[field.field_name]['masked'] and field.field_name in incoming and incoming[field.field_name]!=existing.get(field.field_name)]
    if denied:raise HTTPException(403,'脱敏字段不可直接修改：'+'、'.join(denied))


def has_presentation_rules(fields):
    return any((config(field).get('rules') or {}).get('masked',{}).get('enabled') or 'copyable' in (config(field).get('rules') or {}) for field in fields)


def design_errors(fields):
    errors=[];by_name={field['field_name']:field for field in fields}
    for field in fields:
        rules=(field.get('ui_config') or {}).get('rules') or {}
        for key,modes,default in [('unique',{'form','global','compound'},'form'),('masked',{'role','partial','hidden'},'role'),('copyable',{'normal','maskedCopy','disabled'},'normal')]:
            rule=rules.get(key)
            if not rule:continue
            conditions=rule.get('conditions') or {};mode=strategy(rule,default)
            if mode not in modes:errors.append(f'「{field["label"]}」规则策略无效')
            if key in {'unique','masked'} and rule.get('enabled'):
                settings=(field.get('ui_config') or {}).get('typeSettings') or {}
                if field.get('field_type')=='json' or settings.get('selectionMode')=='multiple' or settings.get('displayMode')=='tags':errors.append(f'「{field["label"]}」唯一与脱敏规则仅支持单值字段')
            if key=='unique' and mode=='compound' and rule.get('enabled'):
                names=conditions.get('fields') or []
                if not isinstance(names,list) or not names or len(names)!=len(set(names)) or field['field_name'] in names or any(name not in by_name or by_name[name]['field_type']=='json' for name in names):errors.append(f'「{field["label"]}」请选择有效且不重复的组合字段')
            if key=='masked':
                role_ids=conditions.get('roleIds') or []
                if not isinstance(role_ids,list) or any(not isinstance(value,int) or isinstance(value,bool) or value<1 for value in role_ids):errors.append(f'「{field["label"]}」脱敏角色配置无效')
                for name in ['keepStart','keepEnd']:
                    value=conditions.get(name,1)
                    if not isinstance(value,int) or isinstance(value,bool) or not 0<=value<=20:errors.append(f'「{field["label"]}」保留字符数必须为 0～20')
    return errors
