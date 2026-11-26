"""Database-backed Agent skill/tool registry."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, or_, select, text

from app.core.db import db_session
from app.models.relational import AIAgentSkillDefinition, AIAgentToolDefinition, SystemSetting, User

from .agent_definition import _load_registry_seed, set_runtime_agent_registry
from .application_menu_registry import REQUESTS as APPLICATION_MENU_REQUESTS, registry_definitions as application_menu_definitions
from .component_page_controls import TOOL_DETAILS, registry_definitions
from .component_page_tools import PAGE_REQUESTS, registry_definitions as page_definitions
from .skills import SkillDefinition
from .tool_handlers import list_tool_handler_keys
from .tool_registry import ToolDefinition, _normalize_input_schema
from .workflow_design_tools import registry_definitions as workflow_design_definitions


AGENT_REGISTRY_SETTINGS_KEY = "ai.agent_registry"
LEGACY_REGISTRY_TENANT_ID = 1
INITIAL_RELEASE_VERSION = "1.0"
_RELEASE_REVISION_FIELD = "_release_version_revision"
_VERSION_FIELDS = {"version", "release_version", "version_bump", _RELEASE_REVISION_FIELD}
_ADMIN_FIELDS = {"created_by", "created_at", "updated_at", "updated_by", "created_by_name", "updated_by_name"}

LEGACY_FORM_TOOL_SCHEMAS = {
    "forms.create_form_definition": {"form": "object", "fields": "array", "menu": "object"},
    "forms.add_form_field": {"form_id": "integer", "form_code": "string", "fields": "array"},
    "platform.form_settings.query": {"subject": "forms|fields|layouts", "limit": "integer"},
}
LEGACY_FORM_TOOL_DESCRIPTIONS = {
    "forms.create_form_definition": {
        "Create a low-code form definition, fields, layouts, and optional application menu binding.",
        "Create a low-code form definition, fields, layouts, and optional menu binding.",
        "Save a low-code form draft with fields and layouts. Publishing and adding a menu entry require separate confirmation.",
    },
    "forms.add_form_field": {
        "Add metadata fields to an existing low-code form.",
        "Add one or more metadata fields to an existing low-code form without directly altering physical business tables.",
    },
    "platform.form_settings.query": {
        "Read low-code form configuration through admin permissions.",
        "Read low-code form configuration such as form definitions, fields, layouts, and publish status through admin permissions.",
    },
}
LEGACY_FORM_TOOL_OUTPUT_SCHEMAS = {
    "forms.create_form_definition": {"form": "object", "fields": "array", "route_path": "string"},
    "platform.form_settings.query": {"items": "array", "count": "integer"},
}


class AgentRegistryError(ValueError):
    """Raised when registry definitions are missing or invalid."""


def _as_name_map(value: Any, *, kind: str) -> dict[str, dict[str, Any]]:
    if isinstance(value, dict):
        items = value.items()
    elif isinstance(value, list):
        items = ((str(item.get("name") or ""), item) for item in value if isinstance(item, dict))
    else:
        raise AgentRegistryError(f"{kind} registry must be an object or array")
    result: dict[str, dict[str, Any]] = {}
    for name, payload in items:
        if not isinstance(payload, dict):
            raise AgentRegistryError(f"{kind} registry item {name!r} must be an object")
        item_name = str(payload.get("name") or name).strip()
        if not item_name:
            raise AgentRegistryError(f"{kind} registry contains an item without name")
        if item_name in result:
            raise AgentRegistryError(f"{kind} registry contains duplicate name {item_name!r}")
        result[item_name] = {**payload, "name": item_name}
    return result


def validate_registry_payload(skills: Any, tools: Any) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    skill_map = _as_name_map(skills, kind="skill")
    tool_map = _as_name_map(tools, kind="tool")
    allowed_handlers = set(list_tool_handler_keys())
    baseline_tools = _load_registry_seed("tools.json")
    management_definitions = application_menu_definitions()
    design_tools = {**page_definitions(), **workflow_design_definitions()}
    baseline_tools.update(management_definitions)
    baseline_tools.update(design_tools)
    canvas_definitions = registry_definitions() if TOOL_DETAILS.keys() & tool_map.keys() else {}

    for name, payload in tool_map.items():
        handler_key = str(payload.get("handler_key") or payload.get("handlerKey") or name)
        payload["handler_key"] = handler_key
        if handler_key not in allowed_handlers:
            raise AgentRegistryError(f"Tool {name} references unregistered handler_key {handler_key!r}")
        if name in APPLICATION_MENU_REQUESTS or handler_key in APPLICATION_MENU_REQUESTS:
            if name != handler_key:
                raise AgentRegistryError("应用与菜单工具必须使用其对应的内置处理器")
            for key in ("input_schema", "side_effect", "permission_check", "domain", "audit_required", "dry_run_supported"):
                if payload.get(key) != management_definitions[name].get(key):
                    raise AgentRegistryError(f"应用与菜单工具 {name} 的 {key} 由平台定义")
        if name in design_tools or handler_key in design_tools:
            label = "页面工具" if name in PAGE_REQUESTS or handler_key in PAGE_REQUESTS else "流程工具"
            if name != handler_key:
                raise AgentRegistryError(f"{label}必须使用其对应的内置处理器")
            for key in ("input_schema", "side_effect", "permission_check", "domain", "audit_required", "dry_run_supported"):
                if payload.get(key) != design_tools[name].get(key):
                    raise AgentRegistryError(f"{label} {name} 的 {key} 由平台定义")
        if name in TOOL_DETAILS or handler_key in TOOL_DETAILS:
            if name != handler_key:
                raise AgentRegistryError("画布工具必须使用其对应的内置处理器")
            contract = canvas_definitions[name]
            baseline_tools[name] = contract
            for key in ("input_schema", "side_effect", "permission_check", "domain"):
                if payload.get(key) != contract[key]:
                    raise AgentRegistryError(f"画布工具 {name} 的 {key} 由编辑器定义")
        baseline = baseline_tools.get(handler_key)
        if baseline and handler_key != "not_implemented":
            if payload.get("side_effect", "read") != baseline.get("side_effect", "read"):
                raise AgentRegistryError(f"Tool {name} cannot change the side effect of handler {handler_key}")
            if payload.get("permission_check", "qa") != baseline.get("permission_check", "qa"):
                raise AgentRegistryError(f"Tool {name} cannot weaken the permission of handler {handler_key}")
            rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
            if rank.get(payload.get("risk_level", "low"), -1) < rank.get(baseline.get("risk_level", "low"), 0):
                raise AgentRegistryError(f"Tool {name} cannot lower handler risk")
        try:
            ToolDefinition(**payload)
            _normalize_input_schema(payload.get("input_schema") or {})
        except (ValueError, TypeError) as exc:
            raise AgentRegistryError(f"Tool {name} has an invalid definition: {exc}") from exc

    for name, payload in skill_map.items():
        if payload.get("default_tool") and payload["default_tool"] not in tool_map:
            raise AgentRegistryError(f"Skill {name} references unknown default_tool {payload['default_tool']!r}")
        for tool_name in payload.get("allowed_tools") or []:
            if tool_name not in tool_map:
                raise AgentRegistryError(f"Skill {name} allowlists unknown tool {tool_name!r}")
        try:
            SkillDefinition(**payload)
        except ValueError as exc:
            raise AgentRegistryError(f"Skill {name} has an invalid definition: {exc}") from exc

    return skill_map, tool_map


def load_seed_registry() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    from .skill_loader import BUNDLED_SKILLS, bundled_skill_package

    skills = _load_registry_seed("skills.json")
    tools = _load_registry_seed("tools.json")
    if not skills or not tools:
        raise AgentRegistryError("Agent registry seed is missing. Run the Agent registry seed before starting Runtime.")
    for name in BUNDLED_SKILLS & skills.keys():
        metadata, _ = bundled_skill_package(name)
        skills[name]["description"] = metadata["description"]
    return validate_registry_payload(skills, {
        **tools, **registry_definitions(), **application_menu_definitions(), **page_definitions(), **workflow_design_definitions(),
    })


async def seed_agent_registry_from_files(*, updated_by: str | None = None, tenant_id: int | None = None) -> dict[str, Any]:
    skills, tools = load_seed_registry()
    return await save_agent_registry_payload(
        {"skills": skills, "tools": tools}, updated_by=updated_by or "seed", seed_import=True, tenant_id=tenant_id,
    )


def _registry_settings_key(tenant_id: int) -> str:
    if tenant_id == LEGACY_REGISTRY_TENANT_ID:
        return AGENT_REGISTRY_SETTINGS_KEY
    return f"{AGENT_REGISTRY_SETTINGS_KEY}:{tenant_id}"


def _tenant_definitions(model, tenant_id: int):
    return select(model).where(model.tenant_id == tenant_id).order_by(model.name)


def _bundled_defaults():
    skills, tools = load_seed_registry()
    for definition in [*skills.values(), *tools.values()]:
        definition.setdefault("created_by", "admin")
        definition.setdefault("enabled", True)
    return skills, tools


def _active_definitions(skills, tools):
    tools = {name: definition for name, definition in tools.items() if definition.get("enabled", True)}
    skills = {
        name: {
            **definition,
            "allowed_tools": [tool for tool in definition.get("allowed_tools", []) if tool in tools],
            "default_tool": definition.get("default_tool") if definition.get("default_tool") in tools else None,
        }
        for name, definition in skills.items() if definition.get("enabled", True)
    }
    return validate_registry_payload(skills, tools)


def _registry_definition(row: AIAgentSkillDefinition | AIAgentToolDefinition) -> dict[str, Any]:
    definition = {key: value for key, value in (row.definition or {}).items() if key not in _VERSION_FIELDS}
    if isinstance(row, AIAgentToolDefinition):
        definition["handler_key"] = row.handler_key
    return {**definition, "name": row.name, "enabled": row.enabled}


def _release_version_parts(row: AIAgentSkillDefinition | AIAgentToolDefinition) -> tuple[int, int]:
    revision = max(1, row.version or 1)
    definition = row.definition or {}
    base_revision = definition.get(_RELEASE_REVISION_FIELD)
    stored_version = definition.get("release_version")
    if type(base_revision) is int and 1 <= base_revision <= revision and isinstance(stored_version, str):
        parts = stored_version.split(".")
        if len(parts) in (2, 3) and all(part.isascii() and part.isdecimal() and len(part) <= 10 for part in parts):
            # Older versions stored an unused middle segment. The revision anchor
            # also accounts for upgrades that increment only the numeric revision.
            major, patch = int(parts[0]), int(parts[-1])
            if major >= 1:
                return major, patch + revision - base_revision
    return 1, revision - 1


def _format_release_version(parts: tuple[int, int]) -> str:
    return ".".join(map(str, parts))


def _refresh_stored_input_schemas(tools: dict[str, dict[str, Any]]) -> None:
    """Use the current platform schema wherever a stored built-in tool is read."""
    platform_tools = {**application_menu_definitions(), **page_definitions(), **workflow_design_definitions()}
    if TOOL_DETAILS.keys() & tools.keys():
        platform_tools.update(registry_definitions())
    for name in platform_tools.keys() & tools.keys():
        if tools[name]["handler_key"] == name:
            tools[name]["input_schema"] = platform_tools[name]["input_schema"]
    previous_descriptions = {
        "forms.validate_workflow_design": {"只读校验流程起止、分支、触发入口、处理人、抄送收件人及注释引用。"},
        "applications.create": {"按名称和编码新建草稿应用。可选设置说明、图标、启动页面、排序和置顶。"},
        "applications.update": {
            "按应用 ID 修改名称、编码、说明、图标、启动页面、排序或置顶。只传需要修改的字段。",
            "按应用 ID 修改基本属性、导航或访问权限组。只传需要修改的字段，access_groups 完整替换权限组。",
        },
        "menus.update_properties": {
            "设置菜单样式和访问权限。permission_mode 选择跟随应用或自定义，access_groups 完整替换自定义权限组。",
        },
    }
    for name, descriptions in previous_descriptions.items():
        if name in tools and tools[name]["handler_key"] == name and tools[name].get("description") in descriptions:
            tools[name]["description"] = platform_tools[name]["description"]
    binding_tools = {
        f"forms.{verb}_workflow_bindings": f"{verb} workflow bindings through the existing form designer with tenant and admin checks."
        for verb in ("list", "create", "update", "delete")
    }
    if binding_tools.keys() & tools.keys():
        seed = _load_registry_seed("tools.json")
        for name, old_description in binding_tools.items():
            if name in tools and tools[name].get("description") == old_description:
                tools[name]["description"] = seed[name]["description"]
    query = tools.get("platform.application_settings.query")
    if query and query.get("input_schema") == {"subject": "applications|menus|routes", "limit": "integer"}:
        definition = _load_registry_seed("tools.json")["platform.application_settings.query"]
        query["input_schema"] = definition["input_schema"]
        if query.get("description") == "查询租户应用。subject=menus 时传 application_id 查询菜单树节点及入口。":
            query["description"] = definition["description"]
    if LEGACY_FORM_TOOL_SCHEMAS.keys() & tools.keys():
        seed = _load_registry_seed("tools.json")
        for name in LEGACY_FORM_TOOL_SCHEMAS.keys() & tools.keys():
            tools[name].update(form_tool_upgrade_fields(tools[name], seed[name]))


def form_tool_upgrade_fields(tool: dict[str, Any], default: dict[str, Any]) -> dict[str, Any]:
    """Return only the fields that still match a known bundled definition."""
    name = default["name"]
    if tool["handler_key"] != default["handler_key"]:
        return {}
    updates = {}
    if tool.get("input_schema") == LEGACY_FORM_TOOL_SCHEMAS[name]:
        updates["input_schema"] = default["input_schema"]
    if name in LEGACY_FORM_TOOL_OUTPUT_SCHEMAS and tool.get("output_schema") == LEGACY_FORM_TOOL_OUTPUT_SCHEMAS[name]:
        updates["output_schema"] = default["output_schema"]
    if tool.get("description") in LEGACY_FORM_TOOL_DESCRIPTIONS[name]:
        updates["description"] = default["description"]
    return updates


def _admin_record(row: AIAgentSkillDefinition | AIAgentToolDefinition) -> dict[str, Any]:
    return {
        **_registry_definition(row),
        "release_version": _format_release_version(_release_version_parts(row)),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by": row.updated_by,
    }


async def _add_registry_actor_names(session, records, tenant_id: int | None) -> None:
    if tenant_id is None:
        return
    actors = {record.get(field) for record in records for field in ("created_by", "updated_by")}
    actors = {actor for actor in actors if isinstance(actor, str) and actor and actor != "admin"}
    if not actors:
        return
    ids = {int(actor) for actor in actors if actor.isascii() and actor.isdecimal() and len(actor) <= 10 and int(actor) <= 2147483647}
    accounts = (await session.execute(
        select(User.id, User.username, User.display_name).where(
            User.tenant_id == tenant_id, or_(User.id.in_(ids), User.username.in_(actors)),
        )
    )).all()
    names = {username: ("超级管理员（admin）" if username == "admin" else display_name or username)
             for _, username, display_name in accounts}
    names.update({str(user_id): names[username] for user_id, username, _ in accounts})
    for record in records:
        for field in ("created_by", "updated_by"):
            actor = record.get(field)
            if actor in names:
                record[f"{field}_name"] = names[actor]


async def load_agent_registry(*, include_disabled: bool = False, tenant_id: int | None = None) -> dict[str, Any]:
    owner = tenant_id if tenant_id is not None else LEGACY_REGISTRY_TENANT_ID
    source = "database"
    async with db_session() as session:
        if session.get_bind().dialect.name == "postgresql":
            await session.execute(text("SELECT pg_advisory_xact_lock_shared(1095911239, :tenant)"), {"tenant": owner})
        elif session.get_bind().dialect.name == "sqlite":
            await session.execute(text("BEGIN"))
        initialized = await session.scalar(select(SystemSetting.id).where(SystemSetting.key == _registry_settings_key(owner)))
        skill_rows = (await session.scalars(_tenant_definitions(AIAgentSkillDefinition, owner))).all()
        tool_rows = (await session.scalars(_tenant_definitions(AIAgentToolDefinition, owner))).all()
        if not initialized and not skill_rows and not tool_rows:
            source = "bundled"
            skills, tools = _bundled_defaults()
            all_skills, all_tools = skills, tools
            if include_disabled:
                all_skills, all_tools = (
                    {name: {**definition, "release_version": INITIAL_RELEASE_VERSION}
                     for name, definition in definitions.items()}
                    for definitions in (skills, tools)
                )
        else:
            skills = {row.name: _registry_definition(row) for row in skill_rows}
            tools = {row.name: _registry_definition(row) for row in tool_rows}
            _refresh_stored_input_schemas(tools)
            all_skills = {row.name: _admin_record(row) for row in skill_rows} if include_disabled else skills
            all_tools = {row.name: {**_admin_record(row), **tools[row.name]} for row in tool_rows} if include_disabled else tools
        if include_disabled:
            await _add_registry_actor_names(session, [*all_skills.values(), *all_tools.values()], tenant_id)
    if not include_disabled or tenant_id is None:
        skills, tools = _active_definitions(skills, tools)
        if tenant_id is None:
            set_runtime_agent_registry(skills=skills, tools=tools)
        if not include_disabled:
            all_skills, all_tools = skills, tools
    return {"skills": all_skills, "tools": all_tools, "source": source, "handlerKeys": list_tool_handler_keys()}


def _registry_content(model, definition):
    content = {key: value for key, value in definition.items()
               if key != "enabled" and key not in _ADMIN_FIELDS and key not in _VERSION_FIELDS}
    try:
        # Legacy definitions omit fields that editors now submit with their defaults.
        return {**content, **model.model_validate(content).model_dump()}
    except ValueError:
        return content


def _validate_registry_transition(skills, tools, previous_skills, previous_tools, *, seed_import=False):
    """Deletion requires a persisted disabled state; activation validates dependencies."""
    for kind, current, previous in (("技能", skills, previous_skills), ("工具", tools, previous_tools)):
        for name, old in previous.items():
            if name not in current and old.get("enabled", True):
                raise AgentRegistryError(f"请先成功停用{kind} {name}，再删除")
        for name, definition in current.items():
            if seed_import or not definition.get("enabled", True):
                continue
            old = previous.get(name)
            if old and old.get("enabled", True):
                model = SkillDefinition if kind == "技能" else ToolDefinition
                updated = _registry_content(model, definition)
                previous_definition = _registry_content(model, old)
                if kind == "技能":
                    for field in ("instructions", "title", "description"):
                        updated.pop(field, None)
                        previous_definition.pop(field, None)
                if updated == previous_definition:
                    continue
            if kind == "工具":
                if definition.get("handler_key") == "not_implemented":
                    raise AgentRegistryError(f"无法启用工具 {name}：尚未绑定已实现的处理器")
            else:
                dependencies = set(definition.get("allowed_tools") or [])
                if definition.get("default_tool"):
                    dependencies.add(definition["default_tool"])
                for dependency in sorted(dependencies):
                    tool = tools.get(dependency)
                    if not tool or not tool.get("enabled", True) or tool.get("handler_key") == "not_implemented":
                        raise AgentRegistryError(f"无法启用技能 {name}：工具 {dependency} 未启用或处理器未实现")


async def lock_agent_registry_write(session, tenant_id: int) -> None:
    if session.get_bind().dialect.name == "postgresql":
        await session.execute(text("SELECT pg_advisory_xact_lock(1095911239, :tenant)"), {"tenant": tenant_id})
    elif session.get_bind().dialect.name == "sqlite":
        # Begin the write transaction before reading the old snapshot.
        await session.execute(text("UPDATE system_settings SET key = key WHERE key = :key"),
                              {"key": _registry_settings_key(tenant_id)})


def _prepare_versions(definitions: dict[str, dict[str, Any]]) -> dict[str, str | None]:
    bumps = {}
    for name, definition in definitions.items():
        bump = definition.get("version_bump")
        if bump not in (None, "patch", "major"):
            raise AgentRegistryError(f"{name} 的版本更新类型必须为 patch 或 major")
        bumps[name] = bump
        for field in _ADMIN_FIELDS | _VERSION_FIELDS:
            definition.pop(field, None)
    return bumps


async def save_agent_registry_payload(payload: dict[str, Any], *, updated_by: str | None = None,
                                      seed_import: bool = False, tenant_id: int | None = None) -> dict[str, Any]:
    skills, tools = validate_registry_payload(payload.get("skills"), payload.get("tools"))
    skill_bumps, tool_bumps = _prepare_versions(skills), _prepare_versions(tools)
    owner = tenant_id if tenant_id is not None else LEGACY_REGISTRY_TENANT_ID
    settings_key = _registry_settings_key(owner)
    async with db_session() as session:
        await lock_agent_registry_write(session, owner)
        skill_rows = {
            row.name: row
            for row in (await session.scalars(_tenant_definitions(AIAgentSkillDefinition, owner))).all()
        }
        tool_rows = {
            row.name: row
            for row in (await session.scalars(_tenant_definitions(AIAgentToolDefinition, owner))).all()
        }
        initialized = await session.scalar(select(SystemSetting.id).where(SystemSetting.key == settings_key))
        previous_skills = {name: _registry_definition(row) for name, row in skill_rows.items()}
        previous_tools = {name: _registry_definition(row) for name, row in tool_rows.items()}
        _refresh_stored_input_schemas(previous_tools)
        if not initialized and not skill_rows and not tool_rows and tenant_id is not None:
            previous_skills, previous_tools = _bundled_defaults()
        builtin_skills, builtin_tools = load_seed_registry() if seed_import else _bundled_defaults()

        for definitions, rows, builtin in ((skills, skill_rows, builtin_skills), (tools, tool_rows, builtin_tools)):
            for name, definition in definitions.items():
                previous = rows.get(name)
                creator = (previous.definition or {}).get("created_by") if previous is not None else updated_by
                if name in builtin and (previous is None or not creator):
                    creator = "admin"
                if creator:
                    definition["created_by"] = creator

        _validate_registry_transition(skills, tools, previous_skills, previous_tools, seed_import=seed_import)

        for model, definitions in ((AIAgentSkillDefinition, skills), (AIAgentToolDefinition, tools)):
            await session.execute(delete(model).where(model.tenant_id == owner, model.name.not_in(definitions)))

        for row_model, model, definitions, rows, previous, bumps in (
            (AIAgentSkillDefinition, SkillDefinition, skills, skill_rows, previous_skills, skill_bumps),
            (AIAgentToolDefinition, ToolDefinition, tools, tool_rows, previous_tools, tool_bumps),
        ):
            for name, definition in definitions.items():
                row = rows.get(name)
                enabled = bool(definition.get("enabled", True))
                if row is None:
                    row = row_model(name=name, tenant_id=owner, version=1)
                    session.add(row)
                    version = INITIAL_RELEASE_VERSION
                elif _registry_content(model, definition) == _registry_content(model, previous[name]):
                    if row.enabled != enabled:
                        row.definition = {**(row.definition or {}), "enabled": enabled}
                        row.enabled = enabled
                        row.updated_by = updated_by
                    continue
                else:
                    major, patch = _release_version_parts(row)
                    next_parts = (major + 1, 0) if bumps[name] == "major" else (major, patch + 1)
                    version = _format_release_version(next_parts)
                    row.version = max(1, row.version or 1) + 1
                row.title = str(definition.get("title") or name)
                row.description = str(definition.get("description") or "")
                if isinstance(row, AIAgentToolDefinition):
                    row.handler_key = str(definition.get("handler_key") or "not_implemented")
                row.definition = {**definition, "release_version": version, _RELEASE_REVISION_FIELD: row.version}
                row.enabled = enabled
                row.source = "database"
                row.updated_by = updated_by

        await _save_registry_settings(session, key=settings_key, updated_by=updated_by, source="database")
        await session.flush()
        saved_skill_rows = (await session.scalars(
            _tenant_definitions(AIAgentSkillDefinition, owner).execution_options(populate_existing=True)
        )).all()
        saved_tool_rows = (await session.scalars(
            _tenant_definitions(AIAgentToolDefinition, owner).execution_options(populate_existing=True)
        )).all()
        saved_skills = {row.name: _admin_record(row) for row in saved_skill_rows}
        saved_tools = {row.name: _admin_record(row) for row in saved_tool_rows}
        _refresh_stored_input_schemas(saved_tools)
        await _add_registry_actor_names(session, [*saved_skills.values(), *saved_tools.values()], tenant_id)
        await session.commit()

    if tenant_id is None:
        active_skills, active_tools = _active_definitions(skills, tools)
        set_runtime_agent_registry(skills=active_skills, tools=active_tools)
    return {"skills": saved_skills, "tools": saved_tools, "source": "database", "handlerKeys": list_tool_handler_keys()}


async def _save_registry_settings(session, *, key: str, updated_by: str | None, source: str) -> None:
    record = await session.scalar(select(SystemSetting).where(SystemSetting.key == key))
    value = {
        "source": source,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "immediateActivation": True,
    }
    if record is None:
        record = SystemSetting(
            key=key,
            value=value,
            description="AI Agent registry activation metadata",
            updated_by=updated_by,
        )
        session.add(record)
    else:
        record.value = value
        record.updated_by = updated_by
