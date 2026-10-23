"""Published role drafts: atomic grants, row scopes, and field requirements."""
import copy
from sqlalchemy import select,delete
from fastapi import HTTPException
from app.models.relational import Role,FormPermission
from app.api.deps import current_tenant_id,current_user_id


async def role_configs(db,user,form,*,cache=None):
    if user.get('is_admin'):return []
    cache=cache if cache is not None else {};key=('designer_roles',form.id)
    if key in cache:return cache[key]
    from app.core.permissions import get_user_role_ids
    ids=await get_user_role_ids(user,db)
    roles=(await db.scalars(select(Role).where(Role.tenant_id==form.tenant_id,Role.id.in_(ids)))).all() if ids else []
    design=(form.config or {}).get('permissionDesign') or {};configured=design.get('roles') or {}
    values=[]
    for role in roles:
        value=configured.get(role.name) or configured.get(role.label)
        if isinstance(value,dict):values.append(value)
    cache[key]=values
    return values


async def sync_published(db,form,config):
    """Invoked in the same transaction as a form version, never during draft save."""
    draft=config.get('permissionDesignDraft')
    if not isinstance(draft,dict):return
    roles=(await db.scalars(select(Role).where(Role.tenant_id==form.tenant_id))).all()
    configured=draft.get('roles') or {}
    for role in roles:
        value=configured.get(role.name) or configured.get(role.label)
        if not isinstance(value,dict):continue
        await db.execute(delete(FormPermission).where(FormPermission.form_id==form.id,FormPermission.tenant_id==form.tenant_id,FormPermission.role_id==role.id))
        for action,enabled in (value.get('actions') or {}).items():
            if action not in {'view','create','edit','delete','import','export','saveDraft','submit','approve'}:continue
            db.add(FormPermission(tenant_id=form.tenant_id,form_id=form.id,role_id=role.id,action=action,effect='allow' if enabled else 'deny'))
        for name,settings in (value.get('fields') or {}).items():
            visible=settings.get('visible',True);editable=visible and settings.get('editable',True)
            for action,allowed in [('view',visible),('create',editable),('edit',editable),('export',visible and settings.get('exportable',True))]:
                db.add(FormPermission(tenant_id=form.tenant_id,form_id=form.id,role_id=role.id,field_name=name,action=action,effect='allow' if allowed else 'deny'))
    config['permissionDesign']=copy.deepcopy(draft)
    await db.flush()


async def row_allowed(db,user,form,record,*,cache=None):
    configs=await role_configs(db,user,form,cache=cache)
    if not configs:return True
    from app.core.permissions import get_user_org_ids
    cache=cache if cache is not None else {}
    if 'designer_orgs' not in cache:cache['designer_orgs']=set(await get_user_org_ids(user,db))
    orgs=cache['designer_orgs'];tree=cache.get('designer_org_tree')
    data=record.get('data') or {};uid=current_user_id(user)
    own=str(record.get('created_by'))==str(uid)
    assigned=any(str(data.get(key))==str(uid) for key in ['assigned_to','assignee_id','current_assignee','handler_id'])
    org=str(data.get('org_unit_id') or '');same=org in {str(value) for value in orgs}
    for config in configs:
        settings=config.get('data') or {};scope=settings.get('scope','all')
        if scope=='org_tree' and tree is None:
            tree=set(await get_user_org_ids(user,db,include_descendants=True));cache['designer_org_tree']=tree
        permitted=scope=='all' or scope=='assigned' and (own or assigned) or scope=='org' and same or scope=='org_tree' and org in {str(value) for value in tree or []} or scope=='custom' and org in {str(value) for value in settings.get('orgUnits') or []}
        flags=settings.get('ownership')
        if isinstance(flags,dict):
            ownership=(own and flags.get('createdByMe',True) or assigned and flags.get('assignedToMe',True)) if own or assigned else flags.get('sameOrg' if same else 'crossOrg',True)
            permitted=permitted and ownership
        if permitted:return True
    return False


async def field_settings(db,user,fields,*,cache=None):
    if db is None or user.get('is_admin') or not fields or not getattr(fields[0],'form_id',None):return {}
    from app.models.relational import Form
    form=await db.get(Form,fields[0].form_id)
    if form is None or form.tenant_id!=current_tenant_id(user):return {}
    configs=await role_configs(db,user,form,cache=cache)
    result={}
    for field in fields:
        flags=[(value.get('fields') or {}).get(field.field_name) for value in configs]
        flags=[value for value in flags if isinstance(value,dict)]
        result[field.field_name]={'required':any(value.get('required') for value in flags),'hidden':any(value.get('visible') is False for value in flags)}
        sensitive=(field.ui_config or {}).get('sensitive') or (((field.ui_config or {}).get('rules') or {}).get('masked') or {}).get('enabled')
        if sensitive:
            modes=[(value.get('data') or {}).get('sensitiveFields') for value in configs]
            result[field.field_name].update(hidden=result[field.field_name]['hidden'] or 'hide' in modes,masked='mask' in modes)
    return result

async def require_action(db,user,form,action):
    configs=await role_configs(db,user,form)
    if any((value.get('actions') or {}).get(action) is False for value in configs):raise HTTPException(403,'角色未获准执行此动作')

async def allow_statistics(db,user,form):
    configs=await role_configs(db,user,form)
    if configs and not any(((value.get('data') or {}).get('ownership') or {}).get('statistics',True) for value in configs):raise HTTPException(403,'角色未获准查看统计汇总')
