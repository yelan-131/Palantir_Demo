"""Tenant-scoped form attachments, served only through authenticated APIs."""
import json
import re
from pathlib import Path
from uuid import uuid4
from fastapi import HTTPException
from app.config import settings

GROUPS = {'图片': ['.png','.jpg','.jpeg','.gif','.webp'], 'pdf':['.pdf'], 'office':['.doc','.docx','.xls','.xlsx','.ppt','.pptx'], '日志文件':['.log','.txt']}

def allowed_extensions(text):
    result=[]
    for part in re.split(r'[,，、;；\s]+', text or ''):
        if not part: continue
        result.extend(GROUPS.get(part.lower(), [part.lower() if part.startswith('.') or '/' in part else '.'+part.lower()]))
    return result

def check_file(name, size, rules):
    if size > min(int(rules.get('maxFileSize') or 20),200)*1024*1024:
        raise HTTPException(422, '附件超过允许的单个文件大小')
    allowed=allowed_extensions(rules.get('fileTypes'))
    suffix=Path(name).suffix.lower()
    if allowed and suffix not in allowed:
        from mimetypes import guess_type
        mime=guess_type(name)[0] or 'application/octet-stream'
        if mime not in allowed and not any(item.endswith('/*') and mime.startswith(item[:-1]) for item in allowed):
            raise HTTPException(422, '附件类型不在允许范围内')

def directory(tenant_id, form_id, field_name):
    # Field names are never interpolated into filesystem paths.
    import hashlib
    key=hashlib.sha256(field_name.encode()).hexdigest()[:24]
    return Path(settings.FORM_FILE_STORAGE_DIR)/str(int(tenant_id))/str(int(form_id))/key

def metadata(tenant_id, form_id, field_name, file_id):
    if not re.fullmatch(r'[a-f0-9]{32}',file_id or ''): raise HTTPException(404,'附件不存在')
    path=directory(tenant_id,form_id,field_name)/file_id
    try: info=json.loads(path.with_suffix('.json').read_text())
    except (OSError,ValueError): raise HTTPException(404,'附件不存在')
    if not path.is_file(): raise HTTPException(404,'附件不存在')
    return info,path

async def save(file, tenant_id, form_id, field_name, uid, rules):
    name=(file.filename or 'attachment').replace('\\','/').split('/')[-1][:200]
    check_file(name,0,rules)
    folder=directory(tenant_id,form_id,field_name);folder.mkdir(parents=True,exist_ok=True)
    file_id=uuid4().hex;path=folder/file_id;size=0
    try:
        with path.open('xb') as stream:
            while chunk := await file.read(1024*1024):
                size+=len(chunk);check_file(name,size,rules);stream.write(chunk)
        info={'id':file_id,'name':name,'size':size,'content_type':file.content_type or 'application/octet-stream','owner_id':uid}
        path.with_suffix('.json').write_text(json.dumps(info,ensure_ascii=False))
        return {k:v for k,v in info.items() if k!='owner_id'}
    except BaseException:
        path.unlink(missing_ok=True);path.with_suffix('.json').unlink(missing_ok=True);raise
    finally: await file.close()

def validate_value(value, *, tenant_id, form_id, field_name, uid, rules, existing=None):
    if not isinstance(value,list) or len(value)>int(rules.get('maxFiles') or 5): raise HTTPException(422,'附件数量或格式不符合配置')
    old_ids={item.get('id') for item in (existing if isinstance(existing,list) else []) if isinstance(item,dict)}
    result=[]
    for item in value:
        if not isinstance(item,dict): raise HTTPException(422,'附件格式无效')
        if item.get('uploading'): raise HTTPException(422,'请等待附件上传完成后再保存')
        info,_=metadata(tenant_id,form_id,field_name,item.get('id'))
        if info['owner_id']!=uid and info['id'] not in old_ids: raise HTTPException(403,'不能关联其他用户尚未授权的附件')
        check_file(info['name'],info['size'],rules)
        result.append({k:v for k,v in info.items() if k!='owner_id'})
    return result
