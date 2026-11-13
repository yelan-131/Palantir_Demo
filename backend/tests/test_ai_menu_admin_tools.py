import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.relational import Application, ApplicationMenuNode, ComponentPage, ComponentPageVersion
from app.services.ai.menu_admin_tools import execute_menu_tool
from tests.test_record_service import environment


@pytest.mark.asyncio
async def test_menu_tools_preview_and_preserve_tree(environment):
    db, _, form, user, _ = environment
    user["is_admin"] = True
    app = Application(tenant_id=1, name="巡检应用", code="inspection")
    foreign = Application(tenant_id=2, name="其他租户", code="foreign")
    page = ComponentPage(tenant_id=1, code="inspection-page", published_version=1)
    db.add_all([app, foreign, page])
    await db.flush()
    db.add(ComponentPageVersion(tenant_id=1, page_id=page.id, version=1, definition={"title": "巡检页面"}))
    await db.commit()

    async def run(operation, *, prepare=False, **payload):
        return await execute_menu_tool(f"menus.{operation}", db, user=user, payload=payload, prepare=prepare)

    with pytest.raises(HTTPException, match="找不到目标应用"):
        await run("create_group", prepare=True, application_id=foreign.id, title="其他租户分组")
    group_review = await run("create_group", prepare=True, application_id=app.id, title="一级")
    assert group_review["_preview"]["target"] == app.name
    assert await db.scalar(select(ApplicationMenuNode.id)) is None
    with pytest.raises(HTTPException, match="请重新生成确认卡片"):
        await run("create_group", **{**group_review, "title": "未获确认"})
    group = await run("create_group", **group_review)
    child_review = await run("create_group", prepare=True, application_id=app.id, parent_id=group["id"], title="二级")
    child = await run("create_group", **child_review)
    with pytest.raises(HTTPException, match="自身或其下级"):
        await run("reorder", prepare=True, application_id=app.id, node_id=group["id"], parent_id=child["id"], position=1)

    entry_review = await run(
        "create_entry", prepare=True, application_id=app.id, page_code=page.code, title="入口",
    )
    entry = await run("create_entry", **entry_review)
    assert entry["route_path"] == f"/pages/{page.code}"
    legacy = ApplicationMenuNode(tenant_id=1, application_id=app.id, title="旧业务入口", node_type="form",
                                 form_id=form.id, parent_id=child["id"], route_path=f"/dynamic/{form.code}")
    db.add(legacy)
    await db.commit()
    with pytest.raises(HTTPException, match="原表单绑定的组件页面"):
        await run("update_entry", prepare=True, application_id=app.id, node_id=legacy.id, page_code=page.code)
    form.config = {**(form.config or {}), "componentPageCode": page.code}
    await db.commit()
    switch_review = await run("update_entry", prepare=True, application_id=app.id, node_id=legacy.id, page_code=page.code)
    assert legacy.node_type == "form"
    switched = await run("update_entry", **switch_review)
    assert (switched["id"], switched["title"], switched["parent_id"]) == (legacy.id, "旧业务入口", child["id"])
    assert (switched["node_type"], switched["form_id"], switched["route_path"]) == ("page", None, f"/pages/{page.code}")
    move_review = await run(
        "reorder", prepare=True, application_id=app.id, node_id=entry["id"], parent_id=group["id"], position=1,
    )
    await run("reorder", **move_review)
    delete_review = await run("delete_entry", prepare=True, application_id=app.id, node_id=group["id"])
    assert delete_review["_preview"]["fields"]["提升至同级的子节点数"] == 2

    edit_review = await run("update_entry", prepare=True, application_id=app.id, node_id=child["id"], title="已改名")
    await run("update_entry", **edit_review)
    with pytest.raises(HTTPException, match="请重新生成确认卡片"):
        await run("delete_entry", **delete_review)
    await db.rollback()
    app_id = delete_review["application_id"]
    delete_review = await run("delete_entry", prepare=True, application_id=app_id, node_id=group["id"])
    assert (await run("delete_entry", **delete_review))["promoted_node_ids"] == [entry["id"], child["id"]]
    roots = (await db.scalars(select(ApplicationMenuNode).where(ApplicationMenuNode.parent_id.is_(None))
                              .order_by(ApplicationMenuNode.sort_order))).all()
    assert [(node.title, node.parent_id) for node in roots] == [("入口", None), ("已改名", None)]
