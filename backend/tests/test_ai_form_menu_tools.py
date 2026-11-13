import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.relational import Application, ApplicationForm, ApplicationMenuNode, FormVersion
from app.services.ai.form_menu_tools import application_menus, publish_form_to_menu
from tests.test_record_service import environment


@pytest.mark.asyncio
async def test_publish_and_attach_is_confirmable_and_repeatable(environment):
    db, factory, form, user, client = environment
    user['is_admin'] = True
    form.status = 'draft'
    app = Application(tenant_id=form.tenant_id, name='生产巡检', code='inspection', status='published')
    db.add(app)
    await db.flush()
    group = ApplicationMenuNode(tenant_id=form.tenant_id, application_id=app.id, title='问题管理', node_type='group')
    db.add(group)
    await db.commit()
    payload = {'form_id': form.id, 'application_id': app.id, 'parent_id': group.id, 'menu_title': '整改跟踪'}
    menus = await application_menus(db, form.tenant_id, app.id, 20)
    assert [item['id'] for item in menus['items']] == [group.id]
    review = await publish_form_to_menu(db, user, payload, prepare=True)
    assert review['destination'] == '生产巡检 / 问题管理 / 整改跟踪'
    assert review['publish_required'] is True
    assert await db.scalar(select(FormVersion.id).where(FormVersion.form_id == form.id)) is None

    with pytest.raises(HTTPException, match='菜单位置已变化'):
        await publish_form_to_menu(db, user, {**review, 'destination': '旧路径'})
    result = await publish_form_to_menu(db, user, review)
    assert await publish_form_to_menu(db, user, review) == result
    assert result['route_path'] == f'/dynamic/{form.code}'
    assert len((await db.scalars(select(FormVersion).where(FormVersion.form_id == form.id))).all()) == 1
    assert await db.scalar(select(ApplicationForm.id).where(ApplicationForm.application_id == app.id, ApplicationForm.form_id == form.id))
    from app.api.deps import get_db

    async def fresh_session():
        async with factory() as session:
            yield session

    client._transport.app.dependency_overrides[get_db] = fresh_session
    runtime = await client.get(f'/forms/{form.id}?schema=published&scope=list')
    assert runtime.status_code == 200, runtime.text
