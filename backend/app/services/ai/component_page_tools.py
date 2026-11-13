"""AI access to the component page editor and its published runtime."""

import hashlib
import json

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.api.component_pages import (
    PageDefinition, PageWrite, RuntimeQuery, create_page, find_page, get_editor,
    list_pages, page_data, save_page_definition, validate_draft_sources, validate_publish,
)
from app.api.deps import require_admin


class PageSearch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    query: str | None = Field(default=None, min_length=1, max_length=100)
    limit: int = Field(default=20, ge=1, le=100)


class PageTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    page_code: str = Field(min_length=1, max_length=100)


class PageDataQuery(PageTarget):
    query: RuntimeQuery = Field(default_factory=RuntimeQuery)


class PageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    definition: PageDefinition


class PageRevision(PageTarget):
    expected_revision: int = Field(gt=0)


class PageSave(PageRevision):
    definition: PageDefinition


PAGE_READ_REQUESTS = {
    "pages.list": PageSearch,
    "pages.get": PageTarget,
    "pages.query": PageDataQuery,
}
PAGE_WRITE_REQUESTS = {
    "pages.create": PageCreate,
    "pages.save_draft": PageSave,
    "pages.publish": PageRevision,
}
PAGE_REQUESTS = {**PAGE_READ_REQUESTS, **PAGE_WRITE_REQUESTS}
PAGE_DETAILS = {
    "pages.list": ("查找通用页面", "按页面标题或编码搜索当前租户的通用页面，返回编码和发布版本。"),
    "pages.get": ("读取页面编辑配置", "读取页面草稿、当前修订号和已发布定义。编辑、发布前读取真实页面编码和修订号。"),
    "pages.query": ("查询已发布页面数据", "查询已发布页面的业务列表、指标和图表数据，应用运行页的访问权限和筛选条件。"),
    "pages.create": ("创建通用页面草稿", "使用页面定义创建草稿。可引用已有表单作为数据源，配置业务列表、业务筛选、指标卡或图表。"),
    "pages.save_draft": ("保存通用页面草稿", "按当前修订号保存页面定义。提交完整定义，保留其余组件和权限配置。"),
    "pages.publish": ("发布通用页面", "按当前修订号发布已保存的页面草稿。发布后可按页面编码挂入应用菜单。"),
}


def registry_definitions():
    definitions = {}
    for name, request in PAGE_REQUESTS.items():
        write = name in PAGE_WRITE_REQUESTS
        configuration = write or name == "pages.get"
        title, description = PAGE_DETAILS[name]
        definitions[name] = {
            "name": name,
            "title": title,
            "description": description,
            "handler_key": name,
            "side_effect": "configuration_write" if write else "read",
            "risk_level": "high" if write else "low",
            "input_schema": request.model_json_schema(),
            "permission_check": "config" if configuration else "qa",
            "domain": "low-code" if configuration else None,
            "dry_run_supported": False,
            "audit_required": write,
        }
    return definitions


async def execute_page_tool(operation, db, *, user, payload, prepare=False):
    if operation in PAGE_WRITE_REQUESTS or operation == "pages.get":
        await require_admin(user)
    request = PAGE_REQUESTS[operation].model_validate({
        key: value for key, value in payload.items() if key not in {"_preview", "_page_snapshot"}
    })
    if operation == "pages.list":
        items = (await list_pages(db, user))["items"]
        if request.query:
            query = request.query.casefold()
            items = [item for item in items if query in item["title"].casefold() or query in item["code"].casefold()]
        return {"items": items[:request.limit], "count": min(request.limit, len(items)), "has_more": len(items) > request.limit}
    if operation == "pages.get":
        return await get_editor(request.page_code, db, user)
    if operation == "pages.query":
        return await page_data(request.page_code, request.query, db, user)

    releasing = operation == "pages.publish"
    if operation == "pages.create":
        definition = request.definition
    else:
        page = await find_page(db, user, request.page_code)
        if page.revision != request.expected_revision:
            raise HTTPException(409, "页面已被其他编辑更新，请重新加载")
        definition = PageDefinition.model_validate(page.draft) if releasing else request.definition

    arguments = request.model_dump(mode="json")
    snapshot = hashlib.sha256(json.dumps(
        [operation, arguments, definition.model_dump(mode="json")], sort_keys=True, ensure_ascii=False,
    ).encode()).hexdigest()
    if not prepare:
        if payload.get("_page_snapshot") != snapshot:
            raise HTTPException(409, "页面确认参数已变化，请重新发起操作")
        if operation == "pages.create":
            return await create_page(definition, db, user)
        body = PageWrite(definition=definition, expectedRevision=request.expected_revision)
        return await save_page_definition(request.page_code, body, db, user, releasing=releasing)

    if releasing:
        await validate_publish(db, user, definition)
    else:
        await validate_draft_sources(db, user, definition)
    fields = {
        "页面名称": definition.title,
        "组件": "、".join(widget.title for widget in definition.widgets) or "无",
        "结果": "已发布页面" if releasing else "页面草稿",
    }
    if definition.sourceFormId:
        fields["数据源表单 ID"] = definition.sourceFormId
    return {**arguments, "_page_snapshot": snapshot, "_preview": {"target": definition.title, "fields": fields}}
