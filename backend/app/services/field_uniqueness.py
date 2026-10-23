"""Tenant-scoped uniqueness for dynamic and physical forms and all record writers."""
import json
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select,text
from app.models.relational import Form,Tenant
from app.services.form_rules import config,control_rule
from app.services.field_policies import strategy


def active_rules(fields):
    return [field for field in fields if not field.archived and (config(field).get('rules') or {}).get('unique',{}).get('enabled')]


async def lock(db,tenant_id):
    # Shared across forms to serialize tenant-wide uniqueness and publish checks.
    if db.bind.dialect.name=='postgresql':
        await db.execute(text('SELECT pg_advisory_xact_lock(1464815189, :tenant)'),{'tenant':tenant_id})
    elif db.bind.dialect.name=='sqlite':
        await db.execute(Tenant.__table__.update().where(Tenant.id==tenant_id).values(id=Tenant.id,updated_at=Tenant.updated_at))


def signature(field,data):
    rule=(config(field).get('rules') or {}).get('unique') or {}
    if not control_rule(rule,data,False):return None
    keys=[field.field_name]
    if strategy(rule,'form')=='compound':keys+=list((rule.get('conditions') or {}).get('fields') or [])
    values=[data.get(key) for key in keys]
    if any(value in (None,'') for value in values):return None
    # Normalize equivalent integral numeric values without coercing strings.
    return tuple(('number',str(Decimal(str(value)).normalize())) if isinstance(value,(int,float)) and not isinstance(value,bool) else ('value',json.dumps(value,ensure_ascii=False,sort_keys=True)) for value in values)


async def candidates(db,form,field,*,skip_current=False):
    from app.services.records import iter_raw,runtime_fields
    mode=strategy((config(field).get('rules') or {}).get('unique') or {},'form')
    if mode!='global':
        if not skip_current:
            async for record in iter_raw(db,form):yield form,record
        return
    forms=(await db.scalars(select(Form).where(Form.tenant_id==form.tenant_id))).all()
    for target in forms:
        if skip_current and target.id==form.id:continue
        fields=await runtime_fields(db,target)
        if not any(other.field_name==field.field_name and not other.archived for other in fields):continue
        async for record in iter_raw(db,target):yield target,record


async def enforce(db,form,fields,data,*,exclude_record_id=None):
    await lock(db,form.tenant_id)
    from app.services.records import runtime_fields
    fields=await runtime_fields(db,form)
    rules=active_rules(fields)
    # A form with no local global rule may still participate in another form's global rule.
    peers=(await db.scalars(select(Form).where(Form.tenant_id==form.tenant_id))).all()
    global_fields=[]
    for peer in peers:
        peer_fields=fields if peer.id==form.id else await runtime_fields(db,peer)
        for field in active_rules(peer_fields):
            if strategy((config(field).get('rules') or {})['unique'],'form')=='global' and field.field_name in data:
                global_fields.append((peer,field))
    if not rules and not global_fields:return
    checks=[(form,field) for field in rules]+global_fields
    done=set()
    for owner,field in checks:
        identity=(owner.id,field.field_name)
        if identity in done:continue
        done.add(identity)
        value=signature(field,data)
        if value is None:continue
        async for target,record in candidates(db,owner,field):
            if target.id==form.id and record['id']==exclude_record_id:continue
            other=signature(field,record['data'])
            if value==other:raise HTTPException(409,f'字段「{field.label}」不满足唯一规则，请使用其他值')


async def publish_errors(db,form,fields):
    errors=[]
    if not active_rules(fields):return errors
    await lock(db,form.tenant_id)
    for field in active_rules(fields):
        seen=set();conflict=False
        async for _,record in candidates(db,form,field):
            value=signature(field,record['data'])
            if value is None:continue
            if value in seen:conflict=True;break
            seen.add(value)
        if conflict:errors.append(f'字段「{field.label}」已有重复记录，启用唯一规则前请先处理')
    return errors
