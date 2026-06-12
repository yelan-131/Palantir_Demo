from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.relational import DataSource, DataSourceMetadata, OntologyCandidate, OntologyObject
from app.services.ai.client import get_provider
from app.services.ai.providers import ProviderConfigurationError
from app.services.ai.schemas import ChatMessage, ChatOptions
from app.services.ai.settings import settings_snapshot, settings_to_provider_config
from app.services.ontology_candidate_service import upsert_candidate


class OntologyAICandidateError(RuntimeError):
    pass


def _json_from_text(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", cleaned, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise OntologyAICandidateError("AI 返回内容不是有效 JSON，请检查模型输出格式") from exc
    if not isinstance(value, dict):
        raise OntologyAICandidateError("AI 返回 JSON 必须是对象")
    return value


def _clamp_confidence(value: Any, default: float = 0.7) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    if number > 1:
        number = number / 100
    return max(0, min(number, 1))


def _source_payload(row: DataSourceMetadata) -> dict[str, Any]:
    return {
        "source_id": row.source_id,
        "source_type": row.source_type,
        "entity_name": row.entity_name,
        "entity_label": row.entity_label,
        "row_count": row.row_count,
        "fields": [
            {
                "name": field.get("name"),
                "label": field.get("label"),
                "type": field.get("type"),
                "primary_key": field.get("primary_key"),
                "nullable": field.get("nullable"),
            }
            for field in (row.fields or [])
            if isinstance(field, dict)
        ],
        "relationships": row.relationships or [],
        "sample_rows": (row.sample_rows or [])[:3],
    }


def _object_payload(obj: OntologyObject) -> dict[str, Any]:
    return {
        "code": obj.code,
        "name": obj.name,
        "domain": obj.domain,
        "description": obj.description,
        "fields": [
            {
                "code": field.code,
                "label": field.label,
                "type": field.field_type,
                "description": field.description,
            }
            for field in (obj.fields or [])
        ],
    }


def _build_prompt(metadata_rows: list[DataSourceMetadata], objects: list[OntologyObject], source: DataSource | None) -> str:
    context = {
        "source": {
            "id": source.id if source else None,
            "name": source.name if source else None,
            "source_type": source.source_type if source else None,
        },
        "metadata": [_source_payload(row) for row in metadata_rows],
        "existing_objects": [_object_payload(obj) for obj in objects],
    }
    return (
        "你是制造业数据语义建模助手。请根据输入的真实结构元数据、样例值、主外键信息和已有对象模型，"
        "生成对象/字段/字段映射/关系候选。不要编造输入中不存在的来源表字段。\n"
        "只返回 JSON，不要 Markdown，不要解释。\n"
        "JSON 结构：{\n"
        '  "objects": [{"code":"Equipment","name":"设备","domain":"manufacturing","description":"...","source_entity":"equipment","confidence":0.9,"evidence":["..."]}],\n'
        '  "fields": [{"object_code":"Equipment","code":"status","name":"状态","field_type":"string","source_entity":"equipment","source_field":"status","confidence":0.85,"evidence":["..."]}],\n'
        '  "mappings": [{"source_id":1,"source_type":"postgresql","source_entity":"equipment","source_field":"status","source_field_type":"string","target_object_code":"Equipment","target_field_code":"status","confidence":0.86,"evidence":["..."]}],\n'
        '  "relations": [{"source_object_code":"WorkOrder","target_object_code":"Equipment","relation_type":"USES","name":"工单使用设备","source_entity":"work_orders","target_entity":"equipment","confidence":0.78,"evidence":["..."]}]\n'
        "}\n"
        f"输入 JSON：{json.dumps(context, ensure_ascii=False, default=str)}"
    )


async def generate_ai_candidates_from_metadata(
    db: AsyncSession,
    *,
    tenant_id: int,
    source_id: int | None = None,
) -> list[OntologyCandidate]:
    settings_data = settings_snapshot()
    config = settings_to_provider_config(settings_data)
    if not config.api_key:
        raise OntologyAICandidateError(f"未配置 {config.provider} API Key，无法执行大模型语义识别")

    metadata_query = select(DataSourceMetadata).where(DataSourceMetadata.tenant_id == tenant_id).order_by(DataSourceMetadata.source_id, DataSourceMetadata.entity_name)
    if source_id is not None:
        metadata_query = metadata_query.where(DataSourceMetadata.source_id == source_id)
    metadata_rows = (await db.execute(metadata_query)).scalars().all()
    if not metadata_rows:
        raise OntologyAICandidateError("没有可识别的结构元数据，请先扫描元数据")

    source = await db.get(DataSource, source_id) if source_id is not None else None
    objects = (
        await db.execute(
            select(OntologyObject)
            .options(selectinload(OntologyObject.fields))
            .where(OntologyObject.tenant_id == tenant_id)
            .order_by(OntologyObject.code)
        )
    ).scalars().unique().all()

    provider = get_provider(config)
    try:
        result = await provider.chat(
            [
                ChatMessage(role="system", content="你只输出可解析 JSON。"),
                ChatMessage(role="user", content=_build_prompt(metadata_rows, objects, source)),
            ],
            ChatOptions(
                model=config.chat_model,
                temperature=0.0,
                max_tokens=6000,
                response_format={"type": "json_object"},
            ),
        )
    except ProviderConfigurationError as exc:
        raise OntologyAICandidateError(str(exc)) from exc

    response = _json_from_text(result.content or "")
    generated: list[OntologyCandidate] = []

    for item in response.get("objects") or []:
        if not isinstance(item, dict) or not item.get("code"):
            continue
        source_entity = str(item.get("source_entity") or "")
        object_code = str(item.get("code"))
        generated.append(await upsert_candidate(
            db,
            tenant_id=tenant_id,
            candidate_type="object",
            candidate_key=f"ai:{source_id or 'all'}:{source_entity}:object:{object_code}",
            title=f"{source_entity or object_code} -> {object_code}",
            payload={
                "object": {
                    "code": object_code,
                    "name": item.get("name") or object_code,
                    "domain": item.get("domain") or "manufacturing",
                    "description": item.get("description"),
                    "source_type": "ai",
                    "source_ref": f"data_source:{source_id}:{source_entity}" if source_id else source_entity,
                },
                "source": {"source_id": source_id, "entity_name": source_entity},
                "evidence": item.get("evidence") or [],
                "ai": {"provider": result.provider, "model": result.model, "usage": result.usage},
            },
            confidence=_clamp_confidence(item.get("confidence"), 0.75),
            source_type="ai",
            source_ref=f"data_source:{source_id}:{source_entity}" if source_id else source_entity,
        ))

    for item in response.get("fields") or []:
        if not isinstance(item, dict) or not item.get("object_code") or not item.get("code"):
            continue
        object_code = str(item.get("object_code"))
        field_code = str(item.get("code"))
        source_entity = str(item.get("source_entity") or "")
        source_field = str(item.get("source_field") or "")
        generated.append(await upsert_candidate(
            db,
            tenant_id=tenant_id,
            candidate_type="field",
            candidate_key=f"ai:{source_id or 'all'}:{source_entity}.{source_field}:field:{object_code}.{field_code}",
            title=f"{object_code}.{field_code}",
            payload={
                "field": {
                    "object_code": object_code,
                    "code": field_code,
                    "name": item.get("name") or field_code,
                    "field_type": item.get("field_type") or "string",
                    "source_type": "ai",
                    "source_ref": f"data_source:{source_id}:{source_entity}.{source_field}" if source_id else f"{source_entity}.{source_field}",
                },
                "source": {"source_id": source_id, "entity_name": source_entity, "field_name": source_field},
                "evidence": item.get("evidence") or [],
                "ai": {"provider": result.provider, "model": result.model, "usage": result.usage},
            },
            confidence=_clamp_confidence(item.get("confidence"), 0.72),
            source_type="ai",
            source_ref=f"data_source:{source_id}:{source_entity}.{source_field}" if source_id else f"{source_entity}.{source_field}",
        ))

    for item in response.get("mappings") or []:
        if not isinstance(item, dict) or not item.get("source_entity") or not item.get("source_field") or not item.get("target_object_code"):
            continue
        source_system = str(item.get("source_id") or source_id or "")
        target_object_code = str(item.get("target_object_code"))
        target_field_code = str(item.get("target_field_code") or "")
        source_entity = str(item.get("source_entity"))
        source_field = str(item.get("source_field"))
        generated.append(await upsert_candidate(
            db,
            tenant_id=tenant_id,
            candidate_type="mapping",
            candidate_key=f"ai:{source_system}:{source_entity}.{source_field}:mapping:{target_object_code}.{target_field_code or '__object__'}",
            title=f"{source_entity}.{source_field} -> {target_object_code}{'.' + target_field_code if target_field_code else ''}",
            payload={
                "mapping": {
                    "source_system": source_system,
                    "source_type": item.get("source_type") or (source.source_type if source else "database"),
                    "source_entity": source_entity,
                    "source_field": source_field,
                    "source_field_type": item.get("source_field_type"),
                    "target_object_code": target_object_code,
                    "target_field_code": target_field_code or None,
                    "evidence": "; ".join(str(e) for e in (item.get("evidence") or [])),
                },
                "source": {"source_id": source_id, "entity_name": source_entity, "field_name": source_field},
                "evidence": item.get("evidence") or [],
                "ai": {"provider": result.provider, "model": result.model, "usage": result.usage},
            },
            confidence=_clamp_confidence(item.get("confidence"), 0.72),
            source_type="ai",
            source_ref=f"data_source:{source_system}:{source_entity}.{source_field}",
        ))

    for item in response.get("relations") or []:
        if not isinstance(item, dict) or not item.get("source_object_code") or not item.get("target_object_code"):
            continue
        source_object_code = str(item.get("source_object_code"))
        target_object_code = str(item.get("target_object_code"))
        relation_type = str(item.get("relation_type") or "RELATED_TO")
        generated.append(await upsert_candidate(
            db,
            tenant_id=tenant_id,
            candidate_type="relation",
            candidate_key=f"ai:{source_id or 'all'}:{source_object_code}:{relation_type}:{target_object_code}",
            title=f"{source_object_code} {relation_type} {target_object_code}",
            payload={
                "relation": {
                    "code": f"{source_object_code}_{relation_type}_{target_object_code}",
                    "name": item.get("name") or f"{source_object_code} {relation_type} {target_object_code}",
                    "relation_type": relation_type,
                    "source_object_code": source_object_code,
                    "target_object_code": target_object_code,
                    "description": item.get("description"),
                    "source_type": "ai",
                    "source_ref": f"data_source:{source_id}:{item.get('source_entity') or ''}",
                },
                "source": {"source_id": source_id, "entity_name": item.get("source_entity"), "target_entity": item.get("target_entity")},
                "evidence": item.get("evidence") or [],
                "ai": {"provider": result.provider, "model": result.model, "usage": result.usage},
            },
            confidence=_clamp_confidence(item.get("confidence"), 0.7),
            source_type="ai",
            source_ref=f"data_source:{source_id}:{item.get('source_entity') or ''}",
        ))

    await db.flush()
    return generated
