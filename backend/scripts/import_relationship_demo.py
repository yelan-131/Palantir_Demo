"""Import the fictional relationship explorer fixture into an existing tenant.

Run from backend: python -m scripts.import_relationship_demo FIXTURE --tenant default
Add --apply to commit the import, or --verify to inspect an existing import.
Without either flag, rehearse the import and roll it back.
"""

import argparse
import asyncio
import json
import re
from pathlib import Path

from sqlalchemy import func, inspect, select

from app.database import AsyncSessionLocal
from app.models.relational import Form, FormAction, FormField, FormLayout, OntologyObject, OntologyRelation, Tenant, User
from app.services import field_uniqueness, ontology_record_service, ontology_service, records
from app.services.form_engine import _physical_table_name_for_form
from app.services.form_schemas import DynamicRecordCreate
from app.services.form_versions import publish_form


async def verify(db, user, fixture):
    tenant_id = user['tenant_id']
    objects = {obj.code: obj for obj in (await db.scalars(select(OntologyObject).where(
        OntologyObject.tenant_id == tenant_id,
        OntologyObject.code.in_([item['code'] for item in fixture['objects']]),
    ))).all()}
    if len(objects) != len(fixture['objects']):
        raise ValueError('The tenant does not have all fixture objects')
    relations = (await db.scalars(select(OntologyRelation).where(
        OntologyRelation.tenant_id == tenant_id,
        OntologyRelation.code.in_([item['code'] for item in fixture['relations']]),
    ))).all()
    by_code = {relation.code: relation for relation in relations}
    for item in fixture['relations']:
        relation = by_code[item['code']]
        if (not relation.graph_enabled or relation.status != 'published'
                or relation.source_object_id != objects[item['source_object_code']].id
                or relation.target_object_id != objects[item['target_object_code']].id
                or relation.metadata_json.get('record_link') != {
                    'source_field': item['source_field'], 'target_field': 'record_no'}):
            raise ValueError(f"Relation differs from the fixture: {item['code']}")

    count = 0
    matches = 0
    for demo in fixture['objects']:
        obj = objects[demo['code']]
        page = await ontology_record_service.list_instances(db, user, obj.id, q=None, page=1, page_size=100)
        field_codes = [field['code'] for field in demo['fields'] if (field.get('ui_config') or {}).get('controlType') != 'upload']
        expected = {row['record_no']: {code: row.get(code) for code in field_codes} for row in demo['records']}
        actual = {row['key']: {code: row['values'].get(code) for code in field_codes} for row in page['items']}
        if page['total'] != len(expected) or actual != expected:
            raise ValueError(f"Object records differ from the fixture: {demo['code']}")
        outgoing = [rel for rel in fixture['relations'] if rel['source_object_code'] == demo['code']]
        for row in demo['records'] if outgoing else ():
            detail = await ontology_record_service.get_instance(db, user, obj.id, row['record_no'])
            actual_links = {rel['code']: rel for rel in detail['relations'] if rel['direction'] == 'outgoing'}
            for rel in outgoing:
                link = actual_links.get(rel['code'], {})
                target_key = row[rel['source_field']]
                if link.get('state') != 'matched' or target_key not in {rec['key'] for rec in link['records']}:
                    raise ValueError(f"Missing relationship {rel['code']} for {row['record_no']}")
                matches += 1
        count += len(expected)
    return {'object_types': len(objects), 'object_records': count, 'relation_types': len(relations), 'record_links': matches}


async def import_fixture(db, user, fixture):
    tenant_id = user['tenant_id']
    actor_id = user['uid']
    await field_uniqueness.lock(db, tenant_id)
    object_codes = [item['code'] for item in fixture['objects']]
    relation_codes = [item['code'] for item in fixture['relations']]
    for model, codes in ((Form, object_codes), (OntologyObject, object_codes), (OntologyRelation, relation_codes)):
        conflicts = (await db.scalars(select(model.code).where(model.tenant_id == tenant_id, model.code.in_(codes)))).all()
        if conflicts:
            raise ValueError(f"Existing {model.__tablename__} would be overwritten: {', '.join(conflicts)}")

    connection = await db.connection()
    table_schema = 'public' if connection.dialect.name == 'postgresql' else None
    for demo in fixture['objects']:
        code = demo['code']
        table_name = _physical_table_name_for_form(tenant_id, code, None)
        if await connection.run_sync(lambda sync: inspect(sync).has_table(table_name, schema=table_schema)):
            raise ValueError(f'Existing business table would be overwritten: {table_name}')
        form = Form(tenant_id=tenant_id, code=code, name=f"【演示】{demo['name']}", description=demo['description'],
                    table_name=table_name, storage_mode='physical_table', status='draft', owner_id=actor_id)
        db.add(form)
        await db.flush()
        children = {'tenant_id': tenant_id, 'form_id': form.id}
        for position, field in enumerate(demo['fields'], start=1):
            key = field['code']
            ui_config = field.get('ui_config')
            db.add(FormField(**children, field_name=key, label=field['label'], field_type=field['type'], required=field.get('required', True),
                             searchable=field.get('searchable', False), sort_order=position,
                             ui_config={'rules': {'unique': {'enabled': True}}} if key == 'record_no' else ui_config))
        for layout_type, config in (('form', {'sections': []}), ('list', {'columns': []})):
            db.add(FormLayout(**children, layout_type=layout_type, config=config))
        for position, (action, label) in enumerate((('create', '新增'), ('edit', '编辑'), ('delete', '删除'), ('export', '导出'))):
            db.add(FormAction(**children, action_key=action, label=label, sort_order=position))
        await db.flush()
        await publish_form(form.id, db, user, defer_commit=True)
        fields = [{'code': field['code'], 'name': field['label'], 'type': field['type'],
                   'required': field.get('required', True), 'searchable': field.get('searchable', False)} for field in demo['fields']]
        obj = await ontology_service.create_or_update_object(db, tenant_id=tenant_id, actor_id=actor_id,
            status='published', data={'code': code, 'name': demo['name'], 'description': demo['description'], 'fields': fields})
        await ontology_record_service.set_record_binding(db, user, obj.id, {
            'form_id': form.id, 'key_field': 'record_no', 'property_fields': {field['code']: field['code'] for field in fields},
        })
        if 'similarity_features' in demo:
            await ontology_service.set_similarity_features(db, tenant_id=tenant_id, object_id=obj.id, actor_id=actor_id,
                features=[ontology_service.OntologySimilarityFeature.model_validate(feature) for feature in demo['similarity_features']])
        for row in demo['records']:
            await records.create_record(form.id, DynamicRecordCreate(data=row), db, user,
                                        defer_commit=True, source='relationship_demo')

    for item in fixture['relations']:
        relation = await ontology_service.create_or_update_relation(db, tenant_id=tenant_id, actor_id=actor_id,
            data={**item, 'description': item.get('description', '制造质量追溯演示关系')})
        await ontology_record_service.set_record_link(db, user, relation.id, {
            'source_field': item['source_field'], 'target_field': 'record_no',
        })


async def run(args):
    fixture = json.loads(args.fixture.read_text(encoding='utf-8'))
    for kind in ('objects', 'relations'):
        codes = [item['code'] for item in fixture[kind]]
        if not codes or len(codes) != len(set(codes)) or not all(re.fullmatch(r'demo_relation_[a-z_]+', code) for code in codes):
            raise ValueError(f'Invalid demo {kind} codes')
    async with AsyncSessionLocal() as db, db.begin() as transaction:
        tenant_id = await db.scalar(select(Tenant.id).where(Tenant.slug == args.tenant))
        admin_id = await db.scalar(select(func.min(User.id)).where(
            User.tenant_id == tenant_id, User.is_admin.is_(True), User.is_active.is_(True),
        ))
        if tenant_id is None or admin_id is None:
            raise ValueError('An existing tenant with an active administrator is required')
        user = {'tenant_id': tenant_id, 'uid': admin_id, 'is_admin': True}
        if not args.verify:
            await import_fixture(db, user, fixture)
        report = await verify(db, user, fixture)
        if not args.apply:
            await transaction.rollback()
    mode = 'imported' if args.apply else 'verified' if args.verify else 'preview_rolled_back'
    print(json.dumps({'tenant': args.tenant, 'mode': mode, **report}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixture', type=Path)
    parser.add_argument('--tenant', required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--verify', action='store_true')
    asyncio.run(run(parser.parse_args()))
