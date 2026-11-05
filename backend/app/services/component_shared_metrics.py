"""Include component-page references in shared-metric impact and atomic release."""
from copy import deepcopy
from sqlalchemy import select
from fastapi import HTTPException
from app.models.relational import ComponentPage, ComponentPageVersion


async def reference_pages(db, tenant_id, metric_id, *, lock_pages=False):
    query = select(ComponentPage).where(ComponentPage.tenant_id == tenant_id).order_by(ComponentPage.id).execution_options(populate_existing=True)
    if lock_pages:
        query = query.with_for_update()
    pages = (await db.scalars(query)).all()
    result = []
    for page in pages:
        states = [('draft', page.draft)]
        if page.published_version:
            version = await db.scalar(select(ComponentPageVersion).where(ComponentPageVersion.page_id == page.id,
                ComponentPageVersion.tenant_id == tenant_id, ComponentPageVersion.version == page.published_version))
            if version:
                states.append(('published', version.definition))
        matching = [(state, definition) for state, definition in states if any(w.get('sharedMetricId') == metric_id for w in definition.get('widgets', []))]
        if matching:
            result.append((page, matching))
    return result


def reference_payload(page, state, definition, metric_id):
    widgets = [w for w in definition['widgets'] if w.get('sharedMetricId') == metric_id]
    return {'formId': -page.id, 'programId': page.code, 'pageCode': page.code, 'boardName': definition['title'],
            'state': state, 'version': page.published_version if state == 'published' else None,
            'widgets': [{'id': w['id'], 'title': w['title'], 'type': w['type']} for w in widgets], 'metricCount': len(widgets)}


async def impact_pages(db, user, metric_id, number, metric):
    from app.api.component_pages import PageDefinition, validate_publish, validate_draft_sources
    pages = await reference_pages(db, user['tenant_id'], metric_id, lock_pages=True)
    plans, refs, signatures, errors = [], [], [], []
    for page, states in pages:
        plan = {'componentPage': page}
        signatures.append([page.id, page.revision, page.published_version, states])
        for state, definition in states:
            refs.append(reference_payload(page, state, definition, metric_id))
            updated = deepcopy(definition)
            for widget in updated['widgets']:
                if widget.get('sharedMetricId') != metric_id:
                    continue
                widget.update(expression=metric['expression'], format=metric['format'], unit=metric.get('unit', ''),
                    threshold=metric.get('threshold', ''), sharedMetricVersion=number,
                    sharedFields=list(dict.fromkeys(metric['dimensions'] + metric['measures'])),
                    dataBinding={'formId': metric['sourceFormId']})
            try:
                value = PageDefinition.model_validate(updated)
                # Check the future definition as local expressions before the new immutable version exists.
                checked = value.model_copy(deep=True)
                for widget in checked.widgets:
                    if widget.sharedMetricId == metric_id:
                        widget.sharedMetricId = None
                await (validate_publish(db, user, checked) if state == 'published' else validate_draft_sources(db, user, checked))
                plan[state] = value.model_dump()
            except (HTTPException, ValueError) as exc:
                errors.append(f"{definition['title']}（{state}）：{getattr(exc, 'detail', str(exc))}")
        plans.append(plan)
    return plans, refs, signatures, errors


async def apply_page_plan(db, plan, user_id, now):
    page = plan['componentPage']
    if 'draft' in plan:
        page.draft = plan['draft']
    page.revision += 1
    if 'published' in plan:
        page.published_version += 1
        db.add(ComponentPageVersion(tenant_id=page.tenant_id, page_id=page.id, version=page.published_version,
            definition=plan['published'], published_by=user_id))
    from app.services.records import change_audit
    await change_audit(db, tenant_id=page.tenant_id, user_id=user_id, action='shared_metric_update',
        resource_type='component_page', resource_id=page.id,
        new_values={'revision': page.revision, 'publishedVersion': page.published_version})
