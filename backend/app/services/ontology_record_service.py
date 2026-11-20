"""Published object instances and scoped links over business records."""

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload

from app.core.principal import current_tenant_id, current_user_id
from app.models.relational import (
    DataSource, Form, MappedFormSyncBinding, OntologyMapping, OntologyObject, OntologyRelation,
)
from app.services import field_uniqueness, records
from app.services.form_rules import config as field_config
from app.services.form_runtime import _field_proxy_from_payload, _latest_form_version
from app.services.ontology_service import log_ontology_action


_KEY_TYPES = {"string": "text", "text": "text", "integer": "integer", "int": "integer"}
_LINK_PREVIEW_LIMIT = 20
MAX_KEY_LENGTH = 200


@dataclass(frozen=True)
class RecordView:
    object_type: OntologyObject
    form: Form
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


async def _view_for_binding(db, user, obj, binding) -> RecordView:
    form = await records.resolve_form(db, user, form_id=binding["form_id"])
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
    return RecordView(obj, form, fields, key_field.field_name, properties)


async def _active_view(db, user, obj) -> RecordView:
    binding = (obj.metadata_json or {}).get("record_binding")
    if not binding:
        raise HTTPException(409, "此对象类型尚未绑定记录来源")
    return await _view_for_binding(db, user, obj, binding)


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
        yield {"instance_id": f"{view.object_type.id}:{key}", "key": key, "values": values, "updated_at": projected.get("updated_at")}, {
            code for code, field in view.properties.items() if field in masked
        }


async def list_instances(db, user, object_id, *, q, page, page_size) -> dict:
    obj = await _published_type(db, current_tenant_id(user), object_id=object_id)
    view = await _active_view(db, user, obj)
    query = q.strip().casefold() if q else ""
    offset = (page - 1) * page_size
    total, items = 0, []
    async for item, masked in _iter_instances(db, user, view):
        if query and query not in item["key"].casefold() and not any(
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
    async for record, _ in _iter_instances(
        db, user, other, filter_field=other.properties[other_property], filter_value=value,
    ):
        section["total"] += 1
        if section["total"] <= _LINK_PREVIEW_LIMIT:
            section["records"].append(record)
    if outgoing and section["total"] > 1:
        section.update(state="ambiguous", records=[])
    elif section["total"]:
        section["state"] = "matched"
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


async def get_instance(db, user, object_id, key) -> dict:
    tenant_id = current_tenant_id(user)
    obj = await _published_type(db, tenant_id, object_id=object_id)
    view = await _active_view(db, user, obj)
    match = None
    async for row in _iter_instances(db, user, view, filter_field=view.key_field, filter_value=key):
        if match is not None:
            raise HTTPException(409, "存在多条同主键的对象记录")
        match = row
    if match is None:
        raise HTTPException(404, "未找到对象实例")
    item, masked = match
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
    return {
        **item, "binding_form": view.form_info, "relations": sections,
        "sources": await _mapped_sources(db, view, set(item["values"]) - masked),
    }
