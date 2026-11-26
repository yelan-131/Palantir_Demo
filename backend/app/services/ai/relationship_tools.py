"""Resolve a published business object and read its visible record relationships."""

from __future__ import annotations

import re
import unicodedata
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select

from app.core.principal import current_tenant_id
from app.models.relational import OntologyObject
from app.services.ontology_record_service import MAX_KEY_LENGTH, get_instance, list_instances

from .schemas import RelationshipEvidenceReference, RelationshipQueryEdge, RelationshipQueryResult, RelationshipRecordReference


TOOL = "graph.query_object_relationships"
SURFACE = "relationship_explorer"
VALVE_PRODUCT_TYPE = "demo_relation_valve_product"
BURST_TYPE = "demo_relation_valve_burst"
MATERIAL_TYPE = "demo_relation_valve_material"
PILOT_MATERIAL_KEY = "A280G6 RH"
RECORD_NAME_FIELDS = (
    "name", "product_name", "grade_name", "process_name", "title", "asset_name", "device_name",
    "equipment_name", "material_name", "part_name", "work_order_name",
)
MAX_RELATION_NEIGHBORS = 59
MAX_RELATION_EDGES = 120
UNAVAILABLE_RECORD_STATUS = {403, 404, 409, 422}

_OBJECT_NAME = r"(?P<object>[^。！？!?,，、\r\n]{1,200}?)"
_QUERY_PREFIX = r"(?:请(?:帮我)?\s*)?(?:(?:查看|查询|查一下|查|看看)\s*)?"
_RELATION_QUERY = re.compile(
    _QUERY_PREFIX + _OBJECT_NAME
    + r"\s*(?:有(?:哪些|什么)(?:关系|关联)|的\s*(?:对象关系|关系|关联)|关联了(?:哪些|什么)对象)[?!.。]?"
)
_MATERIAL_QUERY = re.compile(
    r"(?:(?P<ignore>忽略(?:已填(?:写)?的?|现有的?)?(?:材料)?牌号)[,、 ]*)?"
    + _QUERY_PREFIX + _OBJECT_NAME + r"\s*[能可适](?:以|合)?(?:使用|采用|用)\s*(?:什么|哪些|哪种)材料[?!.。]?"
)


class ObjectRelationshipsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)

    object_query: str = Field(min_length=1, max_length=MAX_KEY_LENGTH)
    object_type: str | None = Field(default=None, min_length=1, max_length=200)
    intent: Literal["relationships", "material_review"] = "relationships"
    ignore_stored_grade: bool = False


def parse_relationship_query(message: str) -> dict | None:
    """Recognize direct read requests without requiring a model credential."""
    normalized = unicodedata.normalize("NFKC", message).strip()
    if match := _RELATION_QUERY.fullmatch(normalized):
        return {"object_query": match["object"].strip()}
    if match := _MATERIAL_QUERY.fullmatch(normalized):
        return {
            "object_query": match["object"].strip(), "intent": "material_review",
            "ignore_stored_grade": bool(match["ignore"]),
        }
    return None


def _display_name(record: dict) -> str:
    masked = set(record.get("masked_fields", ()))
    for code in RECORD_NAME_FIELDS:
        value = record["values"].get(code)
        if code not in masked and isinstance(value, str) and value.strip():
            return value.strip()
    return record["key"]


async def _resolve_objects(db, user: dict, object_types: list, request: ObjectRelationshipsRequest) -> list[dict]:
    type_query = request.object_type.casefold() if request.object_type else None
    matches = []
    for object_type in object_types:
        if type_query and type_query not in (str(object_type.id), object_type.code.casefold(), object_type.name.casefold()):
            continue
        try:
            records = await list_instances(
                db, user, object_type.id, q=request.object_query, page=1, page_size=5,
                exact_name_fields=RECORD_NAME_FIELDS,
            )
        except HTTPException as exc:
            if exc.status_code in UNAVAILABLE_RECORD_STATUS:
                continue
            raise
        matches.extend({
            "object_type_id": object_type.id, "object_type_code": object_type.code,
            "object_type_name": object_type.name, "object_key": record["key"], "object_name": _display_name(record),
        } for record in records["items"])
        if len(matches) >= 5:
            break
    return matches[:5]


def _related_evidence(record: dict, object_type_id: int, related_type_id: int | None) -> tuple:
    neighbors = {}
    edges = {}
    evidence = []
    truncated = False
    root = (object_type_id, record["key"])
    for relation in record["relations"]:
        if relation["state"] != "matched" or (related_type_id is not None and relation["related_object_id"] != related_type_id):
            continue
        if relation["total"] > len(relation["records"]):
            truncated = True
        for related in relation["records"]:
            neighbor = (relation["related_object_id"], related["key"])
            source, target = (root, neighbor) if relation["direction"] == "outgoing" else (neighbor, root)
            edge_id = (relation["id"], source, target)
            if edge_id in edges:
                continue
            if len(edges) >= MAX_RELATION_EDGES or (neighbor not in neighbors and len(neighbors) >= MAX_RELATION_NEIGHBORS):
                truncated = True
                continue
            edge = RelationshipQueryEdge(
                relation_id=relation["id"], source_type_id=source[0], source_key=source[1],
                target_type_id=target[0], target_key=target[1], label=relation["name"],
            )
            reference = RelationshipEvidenceReference(
                object_type_id=neighbor[0], object_key=neighbor[1], label=_display_name(related),
            )
            neighbors[neighbor] = reference
            edges[edge_id] = edge
            detail = {
                **reference.model_dump(), **edge.model_dump(exclude={"label"}), "relation": edge.label,
                "direction": relation["direction"], "basis": relation.get("evidence"),
            }
            if related_type_id is not None:
                detail["measurements"] = {
                    code: value for code, value in related["values"].items()
                    if code in {"burst_min_mpa", "burst_max_mpa", "readings_mpa", "test_temperature", "test_medium", "test_location"}
                    and value is not None and code not in related.get("masked_fields", ())
                }
            evidence.append(detail)
    return list(neighbors.values()), list(edges.values()), evidence, truncated


async def _material_review(db, user: dict, material_type_id: int | None) -> list[RelationshipRecordReference]:
    if material_type_id is None:
        return []
    try:
        material = await get_instance(db, user, material_type_id, PILOT_MATERIAL_KEY)
    except HTTPException as exc:
        if exc.status_code in UNAVAILABLE_RECORD_STATUS:
            return []
        raise
    if not material["values"].get("material_datasheet") or "material_datasheet" in material.get("masked_fields", ()):
        return []
    return [RelationshipRecordReference(object_type_id=material_type_id, object_key=material["key"])]


async def query_object_relationships(db, user: dict, arguments: dict) -> dict:
    try:
        request = ObjectRelationshipsRequest.model_validate(arguments)
    except ValidationError as exc:
        raise HTTPException(422, "请提供对象名称或编号。对象类型可用于缩小查询范围。") from exc

    statement = select(OntologyObject.id, OntologyObject.code, OntologyObject.name).where(
        OntologyObject.tenant_id == current_tenant_id(user), OntologyObject.status == "published",
    ).order_by(OntologyObject.id)
    object_types = (await db.execute(statement)).all()
    matches = await _resolve_objects(db, user, object_types, request)
    if not matches:
        return {"status": "no_match", "message": "未找到名称或编号一致的可查看对象。请核对对象名称、编号或类型。"}
    if len(matches) > 1:
        choices = "、".join(f"{item['object_type_name']} {item['object_name']}（{item['object_key']}）" for item in matches)
        return {"status": "ambiguous", "message": f"找到多个可查看对象：{choices}。请提供对象类型和编号。", "matches": matches}

    match = matches[0]
    object_type_id = match["object_type_id"]
    record = await get_instance(db, user, object_type_id, match["object_key"])
    type_by_code = {obj.code: obj.id for obj in object_types}
    is_valve = match["object_type_code"] == VALVE_PRODUCT_TYPE
    material_review = request.intent == "material_review" and request.ignore_stored_grade and is_valve
    comparison_materials = await _material_review(db, user, type_by_code.get(MATERIAL_TYPE)) if material_review else []
    if material_review and BURST_TYPE not in type_by_code:
        neighbors, edges, evidence, truncated = [], [], [], False
    else:
        test_type_id = type_by_code.get(BURST_TYPE) if material_review else None
        neighbors, edges, evidence, truncated = _related_evidence(record, object_type_id, test_type_id)
    result = RelationshipQueryResult(
        object_type_id=object_type_id, object_key=record["key"], object_name=_display_name(record),
        intent="material_review" if material_review else "relationships", material_parameter_review=material_review,
        evidence_records=neighbors, comparison_materials=comparison_materials, edges=edges, truncated=truncated,
    )
    answer = f"找到「{result.object_name}」（{result.object_key}），读取到 {len(edges)} 条可查看的直接关系。"
    if evidence:
        preview = "、".join(f"{item['relation']} · {item['label']}（{item['object_key']}）" for item in evidence[:5])
        answer += f"{preview}。"
    if truncated or len(evidence) > 5:
        answer += "关系图中可以查看本次已读取的连线及依据。"
    if material_review:
        if comparison_materials:
            answer += (
                f"本次忽略已填牌号，使用 {PILOT_MATERIAL_KEY} 物性表作为对照。整阀爆破压力和材料试片强度"
                "测量对象不同，不能用这两项数据直接判断牌号适用性。关系探索会列出物性依据和待补要求。"
            )
        else:
            answer += "当前没有可查看的对照物性表。"
    elif request.intent == "material_review" and not is_valve:
        answer += "请使用已核实的材料属性和试验条件进一步核对适用性。"
    return {"status": "completed", "message": answer, "relationship_query": result.model_dump(), "evidence": evidence}
