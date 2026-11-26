"""Published object instances and scoped links over business records."""

import hmac
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import String, and_, cast, or_, select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.permissions import allowed_form_fields
from app.core.principal import current_tenant_id, current_user_id
from app.models.relational import (
    DataSource, Form, MappedFormSyncBinding, OntologyMapping, OntologyObject, OntologyRecordMetadata, OntologyRelation,
)
from app.services import field_uniqueness, form_files, form_rules, records
from app.services.designer_permissions import field_settings, require_action
from app.services.form_application_lifecycle import guard_edit
from app.services.form_rules import config as field_config
from app.services.form_runtime import _field_proxy_from_payload, _latest_form_version
from app.services.form_schemas import DynamicRecordUpdate
from app.services.form_workflow_start import _protect_pending_form_record
from app.services.ontology_service import log_ontology_action
from app.services.static_options import parse_options
from app.services.workflow_field_policy import current_policy


_KEY_TYPES = {"string": "text", "text": "text", "integer": "integer", "int": "integer"}
_EDIT_TEXT_TYPES = {"string", "text", "code", "date", "datetime"}
_EDIT_INTEGER_TYPES = {"integer", "int"}
_EDIT_DECIMAL_TYPES = {"number", "decimal", "float"}
_EDIT_VALUE_TYPES = {
    **dict.fromkeys(_EDIT_TEXT_TYPES, (str,)),
    **dict.fromkeys(_EDIT_INTEGER_TYPES, (int,)),
    **dict.fromkeys(_EDIT_DECIMAL_TYPES, (int, float)),
    "enum": (str, int, float),
    "boolean": (bool,),
}
_EDIT_SETTINGS = {"min", "max", "precision", "maxLength", "unit", "checkedText", "uncheckedText", "dateMode"}
_LINK_PREVIEW_LIMIT = 20
MAX_KEY_LENGTH = 200


@dataclass(frozen=True)
class RecordView:
    object_type: OntologyObject
    form: Form
    form_version: int
    fields: list
    key_field: str
    properties: dict[str, str]

    @property
    def key_properties(self) -> set[str]:
        return {code for code, field in self.properties.items() if field == self.key_field}

    @property
    def form_info(self) -> dict:
        return {"id": self.form.id, "code": self.form.code, "name": self.form.name}


async def _published_type(db, tenant_id, *, object_id=None, code=None) -> OntologyObject:
    obj = await db.scalar(select(OntologyObject).options(selectinload(OntologyObject.fields)).where(
        OntologyObject.tenant_id == tenant_id,
        OntologyObject.status == "published",
        OntologyObject.id == object_id if object_id is not None else OntologyObject.code == code,
    ))
    if not obj:
        raise HTTPException(404, "未找到已发布的对象类型")
    return obj


async def _view_for_binding(db, user, obj, binding, *, require_view=True) -> RecordView:
    form = await records.resolve_form(db, user, form_id=binding["form_id"])
    if require_view:
        await records.require_form_permission(db, user, form.id, "view")
    version = await _latest_form_version(db, form.tenant_id, form.id)
    if form.status != "published" or version is None:
        raise HTTPException(409, "对象记录来源需要已发布的业务表单")
    fields = [_field_proxy_from_payload(field) for field in (version.snapshot or {}).get("fields", []) if isinstance(field, dict)]
    available = {field.field_name: field for field in fields if not field.archived}
    key_field = available.get(binding["key_field"])
    if not key_field or str(key_field.field_type).lower() not in _KEY_TYPES:
        raise HTTPException(422, "对象主键必须是已发布的文本或整数字段")
    unique = (field_config(key_field).get("rules") or {}).get("unique") or {}
    conditions = unique.get("conditions") or {}
    if (not unique.get("enabled") or unique.get("conditionGroups")
            or set(conditions) - {"strategy"} or conditions.get("strategy", "form") not in {"form", "global"}):
        raise HTTPException(422, "请为对象主键启用无条件的单字段唯一规则并发布表单")

    codes = {field.code for field in obj.fields if field.status == "published"}
    properties = binding.get("property_fields")
    if properties is None:
        properties = {code: code for code in sorted(codes) if code in available}
    if not set(properties).issubset(codes) or not set(properties.values()).issubset(available):
        raise HTTPException(422, "对象属性映射包含未发布或不存在的字段")
    if key_field.field_name not in properties.values():
        raise HTTPException(422, "请把表单主键映射到对象属性")
    return RecordView(obj, form, version.version, fields, key_field.field_name, properties)


async def _active_view(db, user, obj, *, require_view=True) -> RecordView:
    binding = (obj.metadata_json or {}).get("record_binding")
    if not binding:
        raise HTTPException(409, "此对象类型尚未绑定记录来源")
    return await _view_for_binding(db, user, obj, binding, require_view=require_view)


async def set_record_binding(db, user, object_id, body) -> OntologyObject:
    tenant_id = current_tenant_id(user)
    await field_uniqueness.lock(db, tenant_id)
    obj = await _published_type(db, tenant_id, object_id=object_id)
    view = await _view_for_binding(db, user, obj, body)
    saved_forms = set((await db.scalars(select(MappedFormSyncBinding.form_id).where(
        MappedFormSyncBinding.tenant_id == tenant_id,
        MappedFormSyncBinding.object_code == obj.code,
    ))).all())
    if saved_forms - {view.form.id}:
        raise HTTPException(409, "对象的已保存同步配置使用了其他来源表单")
    current = (obj.metadata_json or {}).get("record_binding") or {}
    next_binding = {"form_id": view.form.id, "key_field": view.key_field, "property_fields": view.properties}
    if saved_forms and (current.get("key_field", view.key_field) != view.key_field or any(
        view.properties.get(code) != field for code, field in current.get("property_fields", {}).items()
    )):
        raise HTTPException(409, "请先处理依赖现有主键和属性映射的已保存同步配置")
    obj.metadata_json = {**(obj.metadata_json or {}), "record_binding": next_binding}
    await log_ontology_action(
        db, tenant_id=tenant_id, action="set_record_binding", resource_type="ontology_object",
        resource_id=obj.id, actor_id=current_user_id(user), detail=next_binding,
    )
    return obj


def _field_kind(view: RecordView, property_code: str) -> str | None:
    field_name = view.properties.get(property_code)
    return next((_KEY_TYPES.get(str(field.field_type).lower()) for field in view.fields if field.field_name == field_name), None)


def _valid_link(source: RecordView, target: RecordView, link: dict) -> bool:
    source_kind = _field_kind(source, link["source_field"])
    return (source_kind is not None and link["target_field"] in target.key_properties
            and source_kind == _field_kind(target, link["target_field"]))


async def set_record_link(db, user, relation_id, link) -> OntologyRelation:
    tenant_id = current_tenant_id(user)
    await field_uniqueness.lock(db, tenant_id)
    rel = await db.scalar(select(OntologyRelation).where(
        OntologyRelation.id == relation_id, OntologyRelation.tenant_id == tenant_id,
        OntologyRelation.status == "published",
    ))
    if not rel:
        raise HTTPException(404, "未找到已发布的关系类型")
    source = await _active_view(db, user, await _published_type(db, tenant_id, code=rel.source_object_code))
    target = await _active_view(db, user, await _published_type(db, tenant_id, code=rel.target_object_code))
    if not _valid_link(source, target, link):
        raise HTTPException(422, "来源属性与目标主键必须是同类型的已映射文本或整数属性")
    rel.metadata_json = {**(rel.metadata_json or {}), "record_link": link}
    await log_ontology_action(
        db, tenant_id=tenant_id, action="set_record_link", resource_type="ontology_relation",
        resource_id=rel.id, actor_id=current_user_id(user), detail=link,
    )
    return rel


def _key(value: Any) -> str | None:
    if isinstance(value, str):
        return value if value.strip() and len(value) <= MAX_KEY_LENGTH else None
    return str(value) if isinstance(value, int) and not isinstance(value, bool) else None


async def _iter_instances(db, user, view, *, filter_field=None, filter_value=None):
    cache = {}
    async for raw in records.iter_raw(db, view.form, fields=view.fields):
        if raw.get("status") in {"draft", "archived"}:
            continue
        key = _key(raw["data"].get(view.key_field))
        if key is None or (filter_field and _key(raw["data"].get(filter_field)) != filter_value):
            continue
        if not await records.record_allowed(db, user, view.form, "view", raw, cache=cache):
            continue
        projected = await records.project_record(db, user, view.form, raw, view.fields, cache=cache)
        masked = {field for field, state in projected.get("field_states", {}).items() if state.get("masked")}
        data = projected["data"]
        if (_key(data.get(view.key_field)) != key or view.key_field in masked
                or (filter_field and (filter_field in masked or _key(data.get(filter_field)) != filter_value))):
            continue
        values = {code: data[field] for code, field in view.properties.items() if field in data}
        masked_codes = {code for code, field in view.properties.items() if field in masked}
        item = {"instance_id": f"{view.object_type.id}:{key}", "key": key, "values": values, "updated_at": projected.get("updated_at")}
        if masked_codes:
            item["masked_fields"] = sorted(masked_codes)
        yield item, masked_codes, raw


async def list_instances(db, user, object_id, *, q, page, page_size, exact_name_fields: tuple[str, ...] | None = None) -> dict:
    obj = await _published_type(db, current_tenant_id(user), object_id=object_id)
    view = await _active_view(db, user, obj)
    query = q.strip().casefold() if q else ""
    offset = (page - 1) * page_size
    total, items = 0, []
    async for item, masked, _ in _iter_instances(db, user, view):
        if query and exact_name_fields is not None:
            visible_names = (item["values"].get(code) for code in exact_name_fields if code not in masked)
            if query != item["key"].strip().casefold() and not any(
                isinstance(value, str) and query == value.strip().casefold() for value in visible_names
            ):
                continue
        elif query and query not in item["key"].casefold() and not any(
            code not in masked and isinstance(value, (str, int, float)) and query in str(value).casefold()
            for code, value in item["values"].items()
        ):
            continue
        if offset <= total < offset + page_size:
            items.append(item)
        total += 1
    return {"items": items, "total": total, "page": page, "page_size": page_size, "binding_form": view.form_info}


async def _related_records(db, user, view, item, masked, rel, *, outgoing: bool) -> dict | None:
    link = (rel.metadata_json or {}).get("record_link")
    if not link:
        return None
    tenant_id = view.object_type.tenant_id
    related_code = rel.target_object_code if outgoing else rel.source_object_code
    related = await _published_type(db, tenant_id, code=related_code)
    section = {
        "id": rel.id, "code": rel.code, "name": rel.name, "direction": "outgoing" if outgoing else "incoming",
        "related_object_id": related.id, "related_object_name": related.name,
        "state": "unbound", "total": 0, "records": [],
    }
    try:
        other = await _active_view(db, user, related)
    except HTTPException as exc:
        if exc.status_code not in {403, 404, 409, 422}:
            raise
        section["state"] = "restricted" if exc.status_code == 403 else "unbound"
        return section
    source, target = (view, other) if outgoing else (other, view)
    if not _valid_link(source, target, link):
        return section
    own_property = link["source_field" if outgoing else "target_field"]
    other_property = link["target_field" if outgoing else "source_field"]
    if own_property in masked or own_property not in item["values"]:
        section["state"] = "restricted"
        return section
    value = _key(item["values"][own_property])
    section["state"] = "missing"
    if value is None:
        return section
    async for record, _masked, _raw in _iter_instances(
        db, user, other, filter_field=other.properties[other_property], filter_value=value,
    ):
        section["total"] += 1
        if section["total"] <= _LINK_PREVIEW_LIMIT:
            section["records"].append(record)
    if outgoing and section["total"] > 1:
        section.update(state="ambiguous", records=[])
    elif section["total"]:
        section["state"] = "matched"
        # Both projected endpoint values were checked against this lookup key.
        section["evidence"] = {
            "source_field": link["source_field"], "source_value": value,
            "target_field": link["target_field"], "target_value": value,
        }
    return section


async def _mapped_sources(db, view, visible_codes) -> dict:
    rows = (await db.execute(select(OntologyMapping, DataSource).join(
        MappedFormSyncBinding, and_(
            MappedFormSyncBinding.tenant_id == OntologyMapping.tenant_id,
            MappedFormSyncBinding.object_code == OntologyMapping.target_object_code,
            MappedFormSyncBinding.entity_name == OntologyMapping.source_entity,
        ),
    ).join(DataSource, and_(DataSource.id == MappedFormSyncBinding.source_id, DataSource.tenant_id == OntologyMapping.tenant_id)).where(
        OntologyMapping.tenant_id == view.object_type.tenant_id,
        OntologyMapping.target_object_code == view.object_type.code,
        OntologyMapping.target_field_code.in_(visible_codes),
        OntologyMapping.status.in_(("approved", "published")),
        MappedFormSyncBinding.form_id == view.form.id,
    ))).all()
    grouped = {}
    for mapping, source in rows:
        if mapping.source_system == str(source.id):
            grouped.setdefault(mapping.target_field_code, []).append({
                "source_id": source.id, "source_name": source.name, "source_entity": mapping.source_entity,
                "source_field": mapping.source_field,
            })
    return {code: origins[0] for code, origins in grouped.items() if len(origins) == 1}


async def _find_instance(db, user, view, key):
    match = None
    async for row in _iter_instances(db, user, view, filter_field=view.key_field, filter_value=key):
        if match is not None:
            raise HTTPException(409, "存在多条同主键的对象记录")
        match = row
    if match is None:
        raise HTTPException(404, "未找到对象实例")
    return match


def _metadata_identity(view, raw):
    return view.object_type.tenant_id, view.object_type.id, view.form.id, raw["id"]


def _record_creation_identity(raw):
    return str(raw.get("created_at") or "")


async def _load_record_metadata(db, view, raw):
    row = await db.get(OntologyRecordMetadata, _metadata_identity(view, raw))
    if row is not None and row.record_created_at == _record_creation_identity(raw):
        return row, row.metadata_json
    return row, {"tags": None, "properties": []}


def _visible_record_metadata(metadata, fields, *, standalone_note):
    result = {"tags": metadata["tags"], "properties": metadata["properties"]}
    labels = {code: label for code, label in (metadata.get("property_labels") or {}).items() if code in fields}
    hidden = sorted(code for code in (metadata.get("hidden_property_codes") or []) if code in fields)
    if labels:
        result["property_labels"] = labels
    if hidden:
        result["hidden_property_codes"] = hidden
    if standalone_note and (note := metadata.get("note_markdown")):
        result["note_markdown"] = note
    return result


def _merge_record_metadata(current, proposed, expected, fields, *, standalone_note):
    if any(current[key] != expected[key] for key in ("tags", "properties")):
        raise HTTPException(409, "对象标签或自定义属性已变化，请重新打开后再保存")

    result = {**current, "tags": proposed["tags"], "properties": proposed["properties"]}
    proposed_labels = proposed.get("property_labels")
    if proposed_labels is not None:
        if proposed_labels.keys() - fields:
            raise HTTPException(403, "包含不可编辑的对象属性名称")
        current_labels = current.get("property_labels") or {}
        editable_labels = {code: label for code, label in current_labels.items() if code in fields}
        if editable_labels != (expected.get("property_labels") or {}):
            raise HTTPException(409, "对象属性名称已变化，请重新打开后再保存")
        protected = {code: label for code, label in current_labels.items() if code not in fields}
        labels = {**protected, **proposed_labels}
        if labels:
            result["property_labels"] = labels
        else:
            result.pop("property_labels", None)

    proposed_hidden = proposed.get("hidden_property_codes")
    if proposed_hidden is not None:
        hidden = set(proposed_hidden)
        if hidden - fields:
            raise HTTPException(403, "包含不可编辑的对象属性")
        current_hidden = set(current.get("hidden_property_codes") or [])
        if current_hidden & fields != set(expected.get("hidden_property_codes") or []):
            raise HTTPException(409, "隐藏属性已变化，请重新打开后再保存")
        hidden.update(current_hidden - fields)
        if hidden:
            result["hidden_property_codes"] = sorted(hidden)
        else:
            result.pop("hidden_property_codes", None)

    note = proposed.get("note_markdown")
    if note is not None:
        if not standalone_note:
            raise HTTPException(403, "请通过映射字段编辑对象正文")
        if (current.get("note_markdown") or "") != (expected.get("note_markdown") or ""):
            raise HTTPException(409, "对象正文已变化，请重新打开后再保存")
        if note:
            result["note_markdown"] = note
        else:
            result.pop("note_markdown", None)
    return result


async def _write_record_metadata(db, user, view, raw, row, current, next_metadata):
    tenant_id, object_id, form_id, record_id = _metadata_identity(view, raw)
    if next_metadata == {"tags": None, "properties": []}:
        if row is not None:
            await db.delete(row)
    else:
        if row is None:
            row = OntologyRecordMetadata(tenant_id=tenant_id, object_id=object_id, form_id=form_id, record_id=record_id)
            db.add(row)
        row.record_created_at = _record_creation_identity(raw)
        row.metadata_json = next_metadata
    context = {"object_id": object_id, "form_id": form_id}
    await records.change_audit(
        db, action="update", resource_type="ontology_record_metadata", resource_id=record_id,
        tenant_id=tenant_id, user_id=current_user_id(user),
        old_values={**context, "record_metadata": current},
        new_values={**context, "record_metadata": next_metadata},
    )


async def get_instance(db, user, object_id, key) -> dict:
    tenant_id = current_tenant_id(user)
    obj = await _published_type(db, tenant_id, object_id=object_id)
    view = await _active_view(db, user, obj)
    item, masked, raw = await _find_instance(db, user, view, key)
    _, record_metadata = await _load_record_metadata(db, view, raw)
    relations = (await db.scalars(select(OntologyRelation).where(
        OntologyRelation.tenant_id == tenant_id, OntologyRelation.status == "published",
        or_(OntologyRelation.source_object_code == obj.code, OntologyRelation.target_object_code == obj.code),
    ).order_by(OntologyRelation.id))).all()
    sections = []
    for rel in relations:
        for outgoing, code in ((True, rel.source_object_code), (False, rel.target_object_code)):
            if code != obj.code:
                continue
            try:
                section = await _related_records(db, user, view, item, masked, rel, outgoing=outgoing)
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
                continue
            if section is not None:
                sections.append(section)
    visible_fields = set(item["values"]) - masked
    return {
        **item, "binding_form": view.form_info, "relations": sections,
        "record_metadata": _visible_record_metadata(
            record_metadata, visible_fields, standalone_note="wiki_markdown" not in view.properties,
        ),
        "sources": await _mapped_sources(db, view, visible_fields),
    }


async def get_instance_attachment(db, user, object_id, key, property_code, file_id) -> tuple[dict, Path]:
    obj = await _published_type(db, current_tenant_id(user), object_id=object_id)
    view = await _active_view(db, user, obj)
    item, masked, _ = await _find_instance(db, user, view, key)
    field_name = view.properties.get(property_code)
    field = next((field for field in view.fields if field.field_name == field_name), None)
    if field is None or field.field_type != "json" or property_code in masked:
        raise HTTPException(404, "附件不存在")
    ui = field.ui_config or {}
    if ui.get("controlType") != "upload":
        raise HTTPException(404, "附件不存在")
    attachments = item["values"].get(property_code)
    if not isinstance(attachments, list) or not any(
        isinstance(attachment, dict) and attachment.get("id") == file_id for attachment in attachments
    ):
        raise HTTPException(404, "附件不存在")
    return form_files.metadata(view.form.tenant_id, view.form.id, field.field_name, file_id)


def _edit_options(field):
    options = field.enum_values
    if isinstance(options, str):
        try:
            options = parse_options(options)
        except ValueError:
            return []
    if isinstance(options, dict):
        options = options.get("values", options)
    if isinstance(options, dict):
        options = [{"value": value, "label": label} for value, label in options.items()]
    if not isinstance(options, list):
        return []
    result = []
    for option in options:
        value = option.get("value") if isinstance(option, dict) else option
        if type(value) in {str, int, float} and (type(value) is not float or math.isfinite(value)):
            label = option.get("label", value) if isinstance(option, dict) else value
            result.append({"label": str(label), "value": value})
    return result


def _edit_field(code, label, field, required):
    kind = str(field.field_type or "string").lower()
    ui = field_config(field)
    control = ui.get("controlType") or field.control_type
    rules = ui.get("typeSettings") or {}
    if form_rules.relation(field) or control not in {
        None, "field", "text", "textarea", "markdown", "code", "number", "switch", "date", "datetime", "select",
    }:
        return None
    descriptor = {"code": code, "label": label, "field_type": kind, "required": required}
    if kind == "enum":
        if rules.get("selectionMode") == "multiple" or rules.get("displayMode") == "tags":
            return None
        options = _edit_options(field)
        if not options:
            return None
        descriptor.update(control_type="select", options=options)
    elif kind in {"date", "datetime"}:
        if rules.get("dateMode") not in {None, "date", "datetime"}:
            return None
        descriptor["control_type"] = kind
    elif kind == "boolean":
        descriptor["control_type"] = "switch"
    elif kind in _EDIT_INTEGER_TYPES or kind in _EDIT_DECIMAL_TYPES:
        descriptor["control_type"] = "number"
    elif kind in _EDIT_TEXT_TYPES:
        if control in {"select", "datetime", "date", "switch", "number"}:
            return None
        descriptor["control_type"] = "textarea" if kind == "text" or code == "wiki_markdown" or control in {"textarea", "markdown"} else "text"
    else:
        return None
    type_settings = {name: value for name, value in rules.items() if name in _EDIT_SETTINGS and value is not None}
    if type_settings:
        descriptor["type_settings"] = type_settings
    return descriptor


def _edit_token(user, view, key, raw):
    identity = [view.object_type.tenant_id, current_user_id(user), view.object_type.id, view.form.id,
                view.form_version, view.key_field, view.properties, key, raw["id"], raw.get("created_at")]
    serialized = json.dumps(identity, sort_keys=True, ensure_ascii=False, default=str).encode()
    return hmac.digest(settings.SECRET_KEY.encode(), serialized, "sha256").hex()


async def _record_editor(db, user, object_id, key, *, lock_record=False):
    obj = await _published_type(db, current_tenant_id(user), object_id=object_id)
    view = await _active_view(db, user, obj)
    cache = {}
    await records.require_form_permission(db, user, view.form.id, "edit", cache=cache)
    item, masked, raw = await _find_instance(db, user, view, key)
    if lock_record:
        locked = await records.read_raw(db, view.form, raw["id"], lock=True, fields=view.fields)
        if locked != raw:
            raise HTTPException(409, "对象记录已变化，请重新打开后再保存")
    await records.require_record_permission(db, user, view.form, "edit", raw, cache=cache)
    if view.form.code == "material-application":
        raise HTTPException(409, "料号申请请通过专用入口修改")
    if await guard_edit(db, view.form, raw, user, cache=cache):
        await require_action(db, user, view.form, "saveDraft", cache=cache)
    await _protect_pending_form_record(db, view.object_type.tenant_id, view.form.id, raw["id"])

    record_data = records.policy_data(raw)
    visible = await allowed_form_fields(user, view.form.id, "view", view.fields, db, record_data=record_data, cache=cache)
    writable = await allowed_form_fields(user, view.form.id, "edit", view.fields, db, record_data=record_data, cache=cache)
    policy = await current_policy(db, user, view.form, raw["id"], cache=cache)
    role_fields = await field_settings(db, user, view.fields, cache=cache)
    states = form_rules.states(view.fields, raw["data"])
    derived = set()
    for field in view.fields:
        ui = field_config(field)
        if not field.archived and ui.get("assignmentRulesEnabled") is not False:
            derived.update((form_rules.relation(field) or {}).get("backfill") or {})
            derived.update(rule.get("targetField") for rule in ui.get("assignmentRules") or [])
    backing_fields = {field.field_name: field for field in view.fields}
    fields, values = {}, {}
    for prop in sorted(obj.fields, key=lambda field: field.id):
        code = prop.code
        name = view.properties.get(code)
        if not name or code in masked or name not in visible or name not in writable or name in derived:
            continue
        state, flags = states[name], policy.get(name) or {}
        backing_field = backing_fields[name]
        if (backing_field.visible_in_form is False or not state["visible"] or state["readonly"]
                or flags.get("visible") is False or flags.get("editable") is False):
            continue
        required = bool(name == view.key_field or state["required"] or flags.get("required") or role_fields.get(name, {}).get("required"))
        field = _edit_field(code, prop.name or code, backing_field, required)
        if field is not None:
            fields[code] = field
            values[code] = item["values"].get(code)
    return view, raw, fields, values


async def get_instance_editor(db, user, object_id, key) -> dict:
    view, raw, fields, values = await _record_editor(db, user, object_id, key)
    _, record_metadata = await _load_record_metadata(db, view, raw)
    standalone_note = "wiki_markdown" not in view.properties
    result = {"fields": list(fields.values()), "values": values, "token": _edit_token(user, view, key, raw),
              "record_metadata": _visible_record_metadata(record_metadata, fields, standalone_note=standalone_note)}
    if standalone_note:
        result["can_edit_note_markdown"] = True
    return result


def _validate_edit_value(field, value):
    if value is None and not field["required"]:
        return
    kind = field["field_type"]
    valid_type = type(value) in _EDIT_VALUE_TYPES[kind]
    finite_value = type(value) is not float or math.isfinite(value)
    valid_enum = kind != "enum" or any(str(option["value"]) == str(value) for option in field["options"])
    if not valid_type or not finite_value or not valid_enum or (field["required"] and value == ""):
        raise HTTPException(422, f"字段「{field['label']}」的值无效")


async def _rename_dependencies(db, user, view):
    tenant_id = view.object_type.tenant_id
    objects = (await db.scalars(select(OntologyObject).options(selectinload(OntologyObject.fields)).where(
        OntologyObject.tenant_id == tenant_id, OntologyObject.status == "published",
    ))).all()
    by_code = {obj.code: obj for obj in objects}
    bindings = {obj.code: (obj.metadata_json or {}).get("record_binding") or {} for obj in objects}
    target_codes = {code for code, binding in bindings.items()
                    if binding.get("form_id") == view.form.id and binding.get("key_field") == view.key_field}
    primary_fields = {}
    for binding in bindings.values():
        if binding.get("form_id") and binding.get("key_field"):
            primary_fields.setdefault(binding["form_id"], set()).add(binding["key_field"])

    sync = MappedFormSyncBinding
    if await db.scalar(select(sync.id).where(
        sync.tenant_id == tenant_id, sync.form_id == view.form.id, sync.object_code.in_(target_codes),
    ).limit(1)) is not None:
        raise HTTPException(409, "此对象主键由已保存的同步配置管理，请先处理该配置")

    relations = (await db.scalars(select(OntologyRelation).where(
        OntologyRelation.tenant_id == tenant_id, OntologyRelation.status == "published",
    ))).all()
    source_forms = {view.form.id} | {bindings.get(rel.source_object_code, {}).get("form_id") for rel in relations
                                   if rel.target_object_code in target_codes}
    views = {view.object_type.code: view}
    references, outgoing = {}, {}
    for relation in relations:
        if bindings.get(relation.source_object_code, {}).get("form_id") not in source_forms:
            continue
        link = (relation.metadata_json or {}).get("record_link") or {}
        if not link.get("source_field") or not link.get("target_field"):
            continue
        for code in (relation.source_object_code, relation.target_object_code):
            if code in views or code not in by_code:
                continue
            try:
                # Discover real dependencies even if the editor cannot see their source rows.
                views[code] = await _active_view(db, user, by_code[code], require_view=False)
            except HTTPException as exc:
                if exc.status_code not in {404, 409, 422}:
                    raise
                views[code] = None
        source, target = views.get(relation.source_object_code), views.get(relation.target_object_code)
        if not source or not target or not _valid_link(source, target, link):
            continue
        field = source.properties[link["source_field"]]
        if relation.target_object_code in target_codes:
            references.setdefault(source.form.id, (source, set()))[1].add(field)
        else:
            outgoing.setdefault((source.form.id, field), {})[(target.form.id, target.key_field)] = target

    managed_fields = {}
    if references:
        mapping = OntologyMapping
        managed = (await db.execute(select(sync.form_id, sync.object_code, mapping.target_field_code).join(mapping, and_(
            mapping.tenant_id == sync.tenant_id, mapping.source_system == cast(sync.source_id, String),
            mapping.source_entity == sync.entity_name, mapping.target_object_code == sync.object_code,
        )).where(
            sync.tenant_id == tenant_id, sync.form_id.in_(references), mapping.target_field_code.is_not(None),
            mapping.status.in_(("approved", "published")),
        ))).all()
        for form_id, code, property_code in managed:
            properties = bindings.get(code, {}).get("property_fields") or {}
            managed_fields.setdefault(form_id, set()).add(properties.get(property_code, property_code))
    return references, outgoing, primary_fields, managed_fields


async def _require_no_other_link_target(db, outgoing, matches, form_id, fields, old_key):
    for field in fields:
        for identity, target in outgoing.get((form_id, field), {}).items():
            if identity not in matches:
                matches[identity] = False
                async for raw in records.iter_raw(db, target.form, fields=target.fields):
                    if raw.get("status") not in {"draft", "archived"} and _key(raw["data"].get(target.key_field)) == old_key:
                        matches[identity] = True
                        break
            if matches[identity]:
                raise HTTPException(409, "当前主键或关联字段仍关联其他对象主键，请先解除该关联")


async def _rename_record_links(db, user, view, original, saved, old_key, new_key):
    references, outgoing, primary_fields, managed_fields = await _rename_dependencies(db, user, view)
    new_value = saved["data"][view.key_field]
    other_keys = primary_fields.get(view.form.id, set()) - {view.key_field}
    if any(original["data"].get(field) != saved["data"].get(field) for field in other_keys):
        raise HTTPException(409, "表单规则会同时改变其他对象主键，无法保存当前主键")
    matches = {}
    await _require_no_other_link_target(db, outgoing, matches, view.form.id, [view.key_field], old_key)

    for form_id, (source, fields) in references.items():
        cache = {}
        source_keys = primary_fields.get(form_id, set())
        protected = source_keys | managed_fields.get(form_id, set())
        hidden = {field.field_name for field in source.fields if field.visible_in_form is False}
        async for raw in records.iter_raw(db, source.form, fields=source.fields):
            if raw.get("status") == "archived":
                continue
            data = raw["data"]
            names = {name for name in fields if _key(data.get(name)) == old_key}
            if not names:
                continue
            if names & protected:
                raise HTTPException(409, "关联字段由同步配置管理或也是对象主键，请先处理关联记录")
            if raw.get("status") != "draft":
                await _require_no_other_link_target(db, outgoing, matches, form_id, names, old_key)
            try:
                await records.require_form_permission(db, user, form_id, "view", cache=cache)
                await records.require_record_permission(db, user, source.form, "view", raw, cache=cache)
                projected = await records.project_record(db, user, source.form, raw, source.fields, cache=cache)
                states = projected["field_states"]
                policy = await current_policy(db, user, source.form, raw["id"], cache=cache)
                if any(name in hidden or name not in projected["data"] or states.get(name, {}).get("masked")
                       or states.get(name, {}).get("readonly") or states.get(name, {}).get("visible") is False
                       or (policy.get(name) or {}).get("editable") is False for name in names):
                    raise HTTPException(403, "关联属性不可编辑")
                await records.update_record(form_id, raw["id"], DynamicRecordUpdate(
                    data=dict.fromkeys(names, new_value), expected_values={name: data[name] for name in names},
                ), db, user, defer_commit=True)
                updated = (await records.read_raw(db, source.form, raw["id"], fields=source.fields))["data"]
                if (any(_key(updated.get(name)) != new_key for name in names)
                        or any(updated.get(name) != data.get(name) for name in source_keys)):
                    raise HTTPException(409, "表单规则改变了关联值或对象主键")
            except HTTPException as exc:
                if exc.status_code not in {403, 404, 409, 422}:
                    raise
                status = 403 if exc.status_code == 403 else 409
                raise HTTPException(status, "关联记录无法同步修改，请检查编辑权限、表单规则或记录状态") from exc


async def update_instance(db, user, object_id, key, data, expected_values, token, *,
                          record_metadata=None, expected_record_metadata=None) -> dict:
    if set(data) != set(expected_values):
        raise HTTPException(422, "请提供每个修改属性的原值")
    if (record_metadata is None) != (expected_record_metadata is None):
        raise HTTPException(422, "请同时提供标签和自定义属性的更新值与原值")
    if not data and record_metadata is None:
        raise HTTPException(422, "没有需要保存的对象属性、标签或自定义属性")
    await field_uniqueness.lock(db, current_tenant_id(user))
    view, raw, fields, _ = await _record_editor(db, user, object_id, key, lock_record=True)
    if not hmac.compare_digest(token, _edit_token(user, view, key, raw)):
        raise HTTPException(409, "对象记录或绑定已变化，请重新打开后再保存")
    if set(data) - fields.keys():
        raise HTTPException(403, "包含不可编辑的对象属性")

    metadata_row = current_metadata = None
    if record_metadata is not None:
        metadata_row, current_metadata = await _load_record_metadata(db, view, raw)
        record_metadata = _merge_record_metadata(
            current_metadata, record_metadata, expected_record_metadata, fields.keys(),
            standalone_note="wiki_markdown" not in view.properties,
        )

    changes, expected = {}, {}
    for code, value in data.items():
        _validate_edit_value(fields[code], value)
        name = view.properties[code]
        if name in changes:
            raise HTTPException(422, "不能同时修改映射到同一表单字段的多个属性")
        changes[name] = value
        expected[name] = expected_values[code]
    saved_key = key
    if changes:
        requested_key = _key(changes[view.key_field]) if view.key_field in changes else key
        if requested_key is None:
            raise HTTPException(422, f"对象主键必须为非空且不超过 {MAX_KEY_LENGTH} 个字符的文本或整数")
        try:
            await records.update_record(view.form.id, raw["id"], DynamicRecordUpdate(data=changes, expected_values=expected),
                                        db, user, defer_commit=True)
            saved = await records.read_raw(db, view.form, raw["id"], fields=view.fields)
            saved_key = _key(saved["data"].get(view.key_field))
            if saved_key != key:
                if requested_key == key or saved_key is None:
                    raise HTTPException(409, "表单规则会改变当前对象的主键，无法从对象记录保存")
                await _rename_record_links(db, user, view, raw, saved, key, saved_key)
        except HTTPException:
            await db.rollback()
            raise
    if record_metadata is not None and record_metadata != current_metadata:
        await _write_record_metadata(db, user, view, raw, metadata_row, current_metadata, record_metadata)
    await db.commit()
    return {"key": saved_key}
