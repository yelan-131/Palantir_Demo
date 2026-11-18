"""Open an application through the connected workbench's own navigation."""

import asyncio
import re
import uuid

from pydantic import BaseModel, ConfigDict, Field

from .page_controls import dispatch_page_action
from .policies import decide_ai_permission

TOOL = "ui.open_application"
PAGE_TOOL = "ui.open_page"


class ApplicationNavigationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    application: str = Field(min_length=1, max_length=100, description="要打开的应用名称或编码")


class MenuPageNavigationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    page: str = Field(min_length=1, max_length=100, description="要打开的应用菜单页名称")
    application: str | None = Field(default=None, min_length=1, max_length=100, description="应用名称或编码，省略时使用当前应用")


def explicit_navigation_request(message: str) -> tuple[str, dict] | None:
    """Handle simple, standalone commands without interpreting other requests."""
    text = message.strip().rstrip("。！!？?🤔🙂😊").strip()
    command = r"(?:请|麻烦)?\s*(?:我想要|我想|我要)?\s*(?:帮我|替我|给我)?\s*(?:打开|进入|切换到)\s*"
    page = re.fullmatch(
        command + r"(?P<app>[\w· ()（）-]{1,75}应用)(?:里的|中的|的)(?P<page>[\w· ()（）-]{1,90})", text,
    )
    if page:
        args = {"page": page["page"].strip()}
        if page["app"] not in {"当前应用", "这个应用"}:
            args["application"] = page["app"].strip()
        return PAGE_TOOL, args
    match = re.fullmatch(
        command + r"(?P<target>[\w· ()（）-]{0,96}应用)(?:吧|一下)?", text,
    )
    if not match:
        match = re.fullmatch(command + r"「(?P<target>[\w· ()（）-]{1,96})」\s*应用", text)
    if not match:
        return None
    target = match["target"].strip()
    if target in {"应用", "一个应用", "某个应用", "这个应用", "那个应用"}:
        return TOOL, {}
    return TOOL, {"application": target}


def navigation_available(bridge, tool=TOOL) -> bool:
    return bool(bridge.event_sink and bridge.context.get("pageControlsSupported")
                and bridge.context.get("surface") != "knowledge"
                and decide_ai_permission(bridge.user, bridge.settings, "qa", skill=tool).allowed)


async def open_navigation(bridge, tool, arguments):
    if not navigation_available(bridge, tool):
        return {"status": "blocked", "message": "当前对话无法操作工作台导航。"}
    is_page = tool == PAGE_TOOL
    request_type = MenuPageNavigationRequest if is_page else ApplicationNavigationRequest
    try:
        request = request_type.model_validate(arguments)
    except ValueError:
        return {"status": "validation_failed", "message": "请提供要打开的菜单页名称。" if is_page else "请提供要打开的应用名称或编码。"}
    command = {"id": uuid.uuid4().hex, "type": "application_navigation",
               "action": "open_page" if is_page else "open_application",
               **request.model_dump(exclude_none=True)}
    try:
        receipt = await dispatch_page_action(bridge, command)
    except asyncio.TimeoutError:
        return {"status": "blocked", "message": "工作台未返回打开结果。"}
    if not receipt.get("ok"):
        return {"status": "blocked", "message": receipt.get("error") or "工作台未完成切换。"}
    state = receipt.get("state") or {}
    name = state["page_name"] if is_page else state["application_name"]
    return {"status": "completed", "message": f"已打开「{name}」。", "result": state}
