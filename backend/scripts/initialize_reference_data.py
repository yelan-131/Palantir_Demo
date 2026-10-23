"""Preview: python -m scripts.initialize_reference_data --tenant-id 1
Apply:   python -m scripts.initialize_reference_data --tenant-id 1 --apply
"""
import argparse
import asyncio
import json

from sqlalchemy import select
from app.core.db import db_session
from app.models.relational import AuditLog, SystemSetting, Tenant
from app.services.reference_data_defaults import existing_master_data, merge_reference_data


async def initialize(tenant_id, apply=False):
    async with db_session() as db:
        # Serialize repeated initializations for this tenant, including first insert.
        tenant = await db.scalar(select(Tenant).where(Tenant.id == tenant_id).with_for_update())
        if tenant is None:
            raise ValueError('租户不存在')
        key = f'reference_data_admin:{tenant_id}'
        row = await db.scalar(select(SystemSetting).where(SystemSetting.key == key).with_for_update())
        before = row.value if row else {}
        masters = await existing_master_data(db, tenant_id)
        payload = merge_reference_data(before, masters)
        changed = payload != before
        if apply and changed:
            if row is None:
                row = SystemSetting(key=key, description='Tenant reference dictionaries and master-data configuration')
                db.add(row)
            row.value = payload
            row.updated_by = 'reference-data-initializer'
            db.add(AuditLog(tenant_id=tenant_id, action='initialize_reference_data', resource_type='reference_data',
                old_values=json.dumps(before, ensure_ascii=False), new_values=json.dumps(payload, ensure_ascii=False)))
            await db.commit()
        return {'tenant_id': tenant_id, 'applied': apply and changed, 'changed': changed,
            'dictionaries': len(payload['dictionaries']),
            'dictionary_options': sum(len(item.get('options', [])) for item in payload['dictionaries']),
            'master_types': len(payload['masterData']),
            'master_records': {item['code']: len(item.get('records', [])) for item in payload['masterData']}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='按编码补齐常用字典和现有基础档案，不覆盖已有值')
    parser.add_argument('--tenant-id', required=True, type=int)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(asyncio.run(initialize(args.tenant_id, args.apply)), ensure_ascii=False))
