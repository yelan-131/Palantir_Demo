"""Sync the bundled application-aware form tools and skills for one tenant."""
import argparse
import asyncio
import sys
from hashlib import sha256
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import db_session
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition
from app.services.ai.agent_registry import (
    LEGACY_FORM_TOOL_SCHEMAS,
    form_tool_upgrade_fields,
    load_seed_registry,
    lock_agent_registry_write,
)
from app.services.ai.skill_loader import bundled_skill_source


UPGRADE_ACTOR = "form-registry-upgrade"
PREVIOUS_SKILL_DESCRIPTIONS = {
    "analysis.analyze_form_records": "查询有权查看的业务表单记录，归纳趋势、类别分布和异常。适用于按时间、班组或问题类别分析巡检等业务数据。",
    "forms.create_record_draft": "按现有业务表单的字段整理用户提供的信息，经确认后保存一条记录草稿。适用于需要先填写、再复核或提交的登记和申请。",
    "low_code.add_form_field": "为现有业务表单准备新增字段，经确认后写入字段配置并同步相关布局。适用于补充字段、控件或字段规则。",
    "low_code.create_form_definition": "配置数据表单的字段、填写规则及草稿。业务列表、登记入口和看板按通用页面技能交付。",
    "low_code.inspect_form": "查看表单布局、历史版本，预演字段规则并检查发布影响。适用于排查表单配置问题，或在发布前确认阻塞项。",
    "low_code.manage_component_page": "搭建或修改业务列表、登记入口、台账、看板和混合页面，配置组件、保存草稿、发布页面并挂载到应用菜单。",
    "low_code.publish_form_to_menu": "在用户明确需要旧表单入口时发布标准表单并挂载。通用页面使用页面发布和菜单工具。",
}
SKILLS = {*PREVIOUS_SKILL_DESCRIPTIONS, "low_code.manage_application", "low_code.manage_workflow_design"}
LOOKUP_SKILLS = {"low_code.create_form_definition", "low_code.add_form_field", "low_code.inspect_form"}
LOOKUP_TOOLS = {"platform.application_settings.query", "platform.form_settings.query"}


async def sync_form_registry(session, tenant_id: int, *, apply: bool) -> dict[str, dict[str, list[str]]]:
    skill_defaults, tool_defaults = load_seed_registry()
    if apply:
        await lock_agent_registry_write(session, tenant_id)

    registered_tools = {
        row.name: row for row in await session.scalars(select(AIAgentToolDefinition).where(
            AIAgentToolDefinition.tenant_id == tenant_id,
            AIAgentToolDefinition.name.in_(LOOKUP_TOOLS | LEGACY_FORM_TOOL_SCHEMAS.keys()),
        ))
    }
    lookup_tools_enabled = all(
        name in registered_tools and registered_tools[name].enabled for name in LOOKUP_TOOLS
    )
    changes = {"skills": {}, "tools": {}}
    for name in sorted(registered_tools.keys() & LEGACY_FORM_TOOL_SCHEMAS.keys()):
        row = registered_tools[name]
        definition = row.definition or {}
        updates = form_tool_upgrade_fields({**definition, "handler_key": row.handler_key}, tool_defaults[name])
        if row.description != definition.get("description"):
            updates.pop("description", None)
        if updates:
            record_update(row, definition, updates, changes["tools"], apply=apply)

    skills = await session.scalars(select(AIAgentSkillDefinition).where(
        AIAgentSkillDefinition.tenant_id == tenant_id, AIAgentSkillDefinition.name.in_(SKILLS),
    ).order_by(AIAgentSkillDefinition.name))
    for row in skills:
        name = row.name
        definition = row.definition or {}
        if definition.get("instructions") is not None or definition.get("source_markdown") is not None:
            continue
        desired = skill_defaults[name]
        source = bundled_skill_source(name)
        if source is None:
            continue
        updates = {}
        digest = sha256(source.encode("utf-8")).hexdigest()
        if definition.get("bundled_source_digest") != digest:
            updates["bundled_source_digest"] = digest
        previous = PREVIOUS_SKILL_DESCRIPTIONS.get(name)
        if previous and row.description == definition.get("description") == previous:
            updates["description"] = desired["description"]

        if name in LOOKUP_SKILLS:
            allowed = desired["allowed_tools"]
            legacy = [tool for tool in allowed if tool not in LOOKUP_TOOLS]
            if definition.get("allowed_tools") == legacy and lookup_tools_enabled:
                updates["allowed_tools"] = allowed
        if updates:
            record_update(row, definition, updates, changes["skills"], apply=apply)
    return changes


def record_update(row, definition, updates, changes, *, apply):
    changes[row.name] = sorted(updates)
    if apply:
        row.definition = {**definition, **updates}
        if "description" in updates:
            row.description = updates["description"]
        row.version += 1
        row.updated_by = UPGRADE_ACTOR


async def main(tenant_id: int, apply: bool) -> None:
    async with db_session() as session:
        changes = await sync_form_registry(session, tenant_id, apply=apply)
        if apply:
            await session.commit()
    action = "Updated" if apply else "Would update"
    for kind, definitions in changes.items():
        print(f"{action} {len(definitions)} {kind} for tenant {tenant_id}")
        for name, fields in definitions.items():
            print(f"  {name}: {', '.join(fields)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", type=int, required=True)
    parser.add_argument("--apply", action="store_true", help="Persist the changes shown by the default dry run.")
    args = parser.parse_args()
    if args.tenant_id <= 0:
        parser.error("--tenant-id must be positive")
    asyncio.run(main(args.tenant_id, args.apply))
