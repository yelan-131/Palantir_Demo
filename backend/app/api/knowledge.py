"""Knowledge base APIs for the local RAG MVP.

The first version intentionally keeps data in a stable demo contract and uses
local TF-IDF retrieval. This makes the feature runnable without external
embedding services while preserving the API shape needed for a future vector
store.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.services.ai.knowledge_ingestion import (
    CHUNKS as INGESTED_CHUNKS,
    DOCUMENTS as INGESTED_DOCUMENTS,
    JOBS as INGESTION_JOBS,
    ingest_asset,
    search_ingested_knowledge,
)
from app.services.ai.ontology_extraction import (
    approve_extraction_job,
    commit_extraction_to_graph,
    create_extraction_job,
    export_extraction,
    get_extraction_job,
    persist_ingestion_result,
)

router = APIRouter()


class KnowledgeSearchBody(BaseModel):
    query: str
    limit: int = 5
    object_type: str | None = None
    object_id: str | None = None


class BindingCandidateBody(BaseModel):
    text: str
    limit: int = 8


class ExtractionApproveBody(BaseModel):
    approved_result: dict[str, Any] | None = None


KNOWLEDGE_SPACES = [
    {
        "id": "personal",
        "name": "个人知识库",
        "scope": "private",
        "owner_role": "知识上传者",
        "review_required": False,
        "description": "个人笔记、临时资料和未发布经验，默认只对本人可见。",
    },
    {
        "id": "team-quality",
        "name": "质量团队知识库",
        "scope": "team",
        "owner_role": "质量工程师",
        "review_required": True,
        "description": "团队复用的异常经验、复检策略和项目资料。",
    },
    {
        "id": "dept-quality",
        "name": "质量部门知识库",
        "scope": "department",
        "owner_role": "质量经理",
        "review_required": True,
        "description": "部门审核后的 SOP、CAPA、质量问题库和处置策略。",
    },
    {
        "id": "enterprise",
        "name": "企业知识库",
        "scope": "enterprise",
        "owner_role": "平台管理员 / 业务专家",
        "review_required": True,
        "description": "跨部门可复用的正式知识，进入工作台和 AI 辅助层引用。",
    },
]


KNOWLEDGE_SOURCES = [
    {
        "id": "quality-sop",
        "name": "质量 SOP",
        "type": "sop",
        "owner": "质量管理部",
        "status": "indexed",
        "document_count": 2,
        "description": "质量异常、缺陷复核、批次冻结和 CAPA 编写规范。",
    },
    {
        "id": "historical-capa",
        "name": "历史 CAPA",
        "type": "capa",
        "owner": "质量工程团队",
        "status": "indexed",
        "document_count": 2,
        "description": "过往质量异常闭环、根因分析、纠正预防措施和审批记录。",
    },
    {
        "id": "supplier-reports",
        "name": "供应商整改报告",
        "type": "supplier_report",
        "owner": "采购与供应商质量",
        "status": "indexed",
        "document_count": 1,
        "description": "供应商提交的 8D、整改说明、批次说明和交付承诺。",
    },
    {
        "id": "equipment-logs",
        "name": "设备日志",
        "type": "equipment_log",
        "owner": "设备工程团队",
        "status": "indexed",
        "document_count": 1,
        "description": "设备报警、温区波动、维护备注和工程师复核记录。",
    },
]


KNOWLEDGE_DOCUMENTS = [
    {
        "id": "doc-sop-qe-001",
        "source_id": "quality-sop",
        "title": "焊点虚焊异常处置 SOP",
        "doc_type": "SOP",
        "status": "indexed",
        "updated_at": "2026-05-20 18:30",
        "summary": "定义 AOI 发现焊点虚焊后的复核、批次隔离、CAPA 和客户影响评估动作。",
        "linked_objects": [
            {"type": "QualityEvent", "id": "QE-20260521-001", "name": "电控模块焊点虚焊异常"},
            {"type": "Defect", "id": "defect-001", "name": "焊点虚焊"},
        ],
    },
    {
        "id": "doc-capa-052",
        "source_id": "historical-capa",
        "title": "CAPA-052 焊锡膏储存异常复盘",
        "doc_type": "CAPA",
        "status": "indexed",
        "updated_at": "2026-04-12 16:10",
        "summary": "历史 CAPA 记录显示焊锡膏冷藏运输和回温时间异常会显著提高虚焊风险。",
        "linked_objects": [
            {"type": "CAPA", "id": "capa-052", "name": "CAPA-052"},
            {"type": "MaterialBatch", "id": "material-batch-mb-7781", "name": "MB-7781 / 焊锡膏 S12"},
        ],
    },
    {
        "id": "doc-supplier-bc-8d",
        "source_id": "supplier-reports",
        "title": "北辰电子材料 8D 整改报告",
        "doc_type": "SupplierReport",
        "status": "indexed",
        "updated_at": "2026-05-18 10:45",
        "summary": "供应商说明同批次焊锡膏存在冷链温度记录缺口，承诺补充批次追溯和运输温控证明。",
        "linked_objects": [
            {"type": "Supplier", "id": "supplier-s-023", "name": "北辰电子材料"},
            {"type": "MaterialBatch", "id": "material-batch-mb-7781", "name": "MB-7781 / 焊锡膏 S12"},
        ],
    },
    {
        "id": "doc-equipment-smt-03",
        "source_id": "equipment-logs",
        "title": "SMT-03 回流焊温区 5 波动记录",
        "doc_type": "EquipmentLog",
        "status": "indexed",
        "updated_at": "2026-05-21 09:35",
        "summary": "设备日志显示温区 5 在异常前 20 分钟有轻微偏移，建议工程师复核温控曲线。",
        "linked_objects": [
            {"type": "Equipment", "id": "equipment-smt-03", "name": "SMT-03 回流焊"},
            {"type": "WorkOrder", "id": "workorder-260521-017", "name": "WO-260521-017"},
        ],
    },
    {
        "id": "doc-customer-risk",
        "source_id": "quality-sop",
        "title": "客户交付风险沟通规范",
        "doc_type": "SOP",
        "status": "indexed",
        "updated_at": "2026-05-10 14:00",
        "summary": "当质量异常影响客户订单时，应先确认替代批次，再由销售或客服发出交付风险说明。",
        "linked_objects": [
            {"type": "CustomerOrder", "id": "order-so-8821", "name": "SO-8821 / 华东客户"},
            {"type": "QualityEvent", "id": "QE-20260521-001", "name": "电控模块焊点虚焊异常"},
        ],
    },
]


KNOWLEDGE_CARDS = [
    {
        "id": "card-solder-void",
        "space_id": "dept-quality",
        "title": "焊点虚焊处理策略",
        "status": "published",
        "owner": "质量经理",
        "reviewer": "质量体系负责人",
        "updated_at": "2026-05-21 10:20",
        "scenario": "AOI 连续发现 BGA 区域焊点虚焊，缺陷率超过管控线。",
        "guidance": [
            "冻结同批次物料和在制品，避免继续投入生产。",
            "发起 BGA 区域复检，并把同班次工单纳入抽查范围。",
            "检查回流炉温区曲线和焊锡膏储运记录。",
            "若缺陷重复出现，生成 CAPA 并进入质量审批。",
        ],
        "risk_notes": [
            "不要在供应商温控证明未补齐前释放同仓储批次。",
            "客户订单受影响时，先确认替代批次再承诺交期。",
        ],
        "evidence_refs": [
            {"document_id": "doc-sop-qe-001", "source_ref": "焊点虚焊异常处置 SOP / 第 2-3 节"},
            {"document_id": "doc-capa-052", "source_ref": "CAPA-052 / 根因分析与纠正预防措施"},
        ],
        "linked_objects": [
            {"type": "QualityEvent", "id": "QE-20260521-001", "name": "电控模块焊点虚焊异常"},
            {"type": "Defect", "id": "defect-001", "name": "焊点虚焊"},
            {"type": "MaterialBatch", "id": "material-batch-mb-7781", "name": "MB-7781 / 焊锡膏 S12"},
            {"type": "Equipment", "id": "equipment-smt-03", "name": "SMT-03 回流焊"},
        ],
        "backlinks": ["card-supplier-batch-risk", "card-reflow-zone-check"],
    },
    {
        "id": "card-supplier-batch-risk",
        "space_id": "dept-quality",
        "title": "供应商批次风险判断",
        "status": "published",
        "owner": "SQE 主管",
        "reviewer": "采购质量经理",
        "updated_at": "2026-05-20 15:35",
        "scenario": "供应商报告、来料记录或批次追溯显示温控、运输或仓储证据缺口。",
        "guidance": [
            "隔离同批次和同仓储风险物料。",
            "通知采购和 SQE 补充供应商 8D / 温控证明。",
            "提高后续来料抽检比例，并与质量事件建立关联。",
        ],
        "risk_notes": [
            "供应商整改报告处于 reviewing 状态时，只能作为处置参考，不能替代正式放行依据。",
        ],
        "evidence_refs": [
            {"document_id": "doc-supplier-bc-8d", "source_ref": "北辰电子材料 8D 整改报告 / D4"},
            {"document_id": "doc-capa-052", "source_ref": "CAPA-052 / 纠正预防措施"},
        ],
        "linked_objects": [
            {"type": "Supplier", "id": "supplier-s-023", "name": "北辰电子材料"},
            {"type": "MaterialBatch", "id": "material-batch-mb-7781", "name": "MB-7781 / 焊锡膏 S12"},
        ],
        "backlinks": ["card-solder-void"],
    },
    {
        "id": "card-reflow-zone-check",
        "space_id": "team-quality",
        "title": "回流焊温区异常排查",
        "status": "reviewing",
        "owner": "设备工程师",
        "reviewer": "设备主管",
        "updated_at": "2026-05-21 09:50",
        "scenario": "质量异常前后设备日志出现温区偏移、未停机报警或工程师维护备注。",
        "guidance": [
            "拉取异常前后 30 分钟温控曲线。",
            "比对同班次工单和首件复检记录。",
            "必要时创建设备检查任务并暂停同线同批次继续生产。",
        ],
        "risk_notes": [
            "轻微偏移未触发停机时，也要与缺陷率和物料批次共同判断。",
        ],
        "evidence_refs": [
            {"document_id": "doc-equipment-smt-03", "source_ref": "SMT-03 设备日志 / 09:12-09:35"},
        ],
        "linked_objects": [
            {"type": "Equipment", "id": "equipment-smt-03", "name": "SMT-03 回流焊"},
            {"type": "WorkOrder", "id": "workorder-260521-017", "name": "WO-260521-017"},
        ],
        "backlinks": ["card-solder-void"],
    },
]


DATA_CLEANING_CANDIDATES = [
    {
        "text": "北辰电子材料",
        "object_type": "Supplier",
        "object_id": "supplier-s-023",
        "object_name": "北辰电子材料",
        "confidence": 0.96,
        "match_type": "exact",
        "alias": ["北辰材料", "Beichen", "SUP-BEICHEN"],
    },
    {
        "text": "MB-7781",
        "object_type": "MaterialBatch",
        "object_id": "material-batch-mb-7781",
        "object_name": "MB-7781 / 焊锡膏 S12",
        "confidence": 0.94,
        "match_type": "batch_code",
        "alias": ["焊锡膏 S12", "S12 锡膏"],
    },
    {
        "text": "SMT-03",
        "object_type": "Equipment",
        "object_id": "equipment-smt-03",
        "object_name": "SMT-03 回流焊",
        "confidence": 0.91,
        "match_type": "equipment_code",
        "alias": ["三号回流炉", "SMT03"],
    },
    {
        "text": "焊点虚焊",
        "object_type": "Defect",
        "object_id": "defect-001",
        "object_name": "焊点虚焊",
        "confidence": 0.88,
        "match_type": "semantic",
        "alias": ["空焊", "虚焊", "BGA 焊接不良"],
    },
    {
        "text": "WO-260521-017",
        "object_type": "WorkOrder",
        "object_id": "workorder-260521-017",
        "object_name": "WO-260521-017",
        "confidence": 0.86,
        "match_type": "workorder_code",
        "alias": ["电控模块 V2 工单"],
    },
]


OCR_PIPELINE_STEPS = [
    {"key": "upload", "title": "资料上传", "owner": "上传者", "description": "接入 PDF、图片、扫描件、Excel 或外部系统附件。"},
    {"key": "ocr", "title": "OCR 与版面识别", "owner": "系统", "description": "提取文字、表格、页眉页脚、签名区，并标记低置信度字段。"},
    {"key": "extract", "title": "实体抽取", "owner": "系统 / AI", "description": "识别供应商、物料批次、设备、工单、缺陷、客户订单等业务实体。"},
    {"key": "match", "title": "主数据匹配", "owner": "数据管理员", "description": "与 ERP、MES、QMS、设备台账和本体对象匹配，处理别名与重复项。"},
    {"key": "draft", "title": "知识条目草稿", "owner": "AI + 上传者", "description": "编译成 Obsidian 风格 Markdown 知识条目，保留证据来源。"},
    {"key": "review", "title": "审核发布", "owner": "业务负责人", "description": "确认内容、对象绑定、权限范围后发布到团队/部门/企业知识库。"},
]


KNOWLEDGE_CHUNKS = [
    {
        "id": "chunk-sop-qe-001-1",
        "document_id": "doc-sop-qe-001",
        "source_ref": "焊点虚焊异常处置 SOP / 第 2 节",
        "chunk_text": "AOI 连续发现焊点虚焊且缺陷率超过 2.0% 管控线时，应立即触发质量异常事件，并由质量经理确认影响范围。",
    },
    {
        "id": "chunk-sop-qe-001-2",
        "document_id": "doc-sop-qe-001",
        "source_ref": "焊点虚焊异常处置 SOP / 第 3 节",
        "chunk_text": "处置顺序建议为：冻结风险物料批次，发起复检，生成 CAPA 草稿，通知采购确认供应商批次风险。",
    },
    {
        "id": "chunk-capa-052-1",
        "document_id": "doc-capa-052",
        "source_ref": "CAPA-052 / 根因分析",
        "chunk_text": "历史案例 CAPA-052 显示，焊锡膏冷藏运输温度异常、回温时间不足和开封后暴露时间过长，均会增加焊点虚焊概率。",
    },
    {
        "id": "chunk-capa-052-2",
        "document_id": "doc-capa-052",
        "source_ref": "CAPA-052 / 纠正预防措施",
        "chunk_text": "纠正措施包括补充冷链记录、限制开封后使用时长、增加首件复检频率，并要求供应商提供批次温控证明。",
    },
    {
        "id": "chunk-supplier-bc-1",
        "document_id": "doc-supplier-bc-8d",
        "source_ref": "北辰电子材料 8D 整改报告 / D4",
        "chunk_text": "北辰电子材料承认 MB-7781 批次存在运输温控记录缺口，建议先冻结该批次待判定库存并补充供应商复核。",
    },
    {
        "id": "chunk-equipment-smt-03-1",
        "document_id": "doc-equipment-smt-03",
        "source_ref": "SMT-03 设备日志 / 09:12-09:35",
        "chunk_text": "SMT-03 回流焊温区 5 在 09:12 后出现轻微偏移，虽然未触发停机，但建议创建设备检查任务并复核温控曲线。",
    },
    {
        "id": "chunk-customer-risk-1",
        "document_id": "doc-customer-risk",
        "source_ref": "客户交付风险沟通规范 / 第 1 节",
        "chunk_text": "当异常影响客户订单时，应在质量经理确认隔离范围后，由销售确认替代批次和交付承诺，不建议直接承诺原交期。",
    },
]


def _document_by_id(document_id: str) -> dict[str, Any]:
    return next(item for item in KNOWLEDGE_DOCUMENTS if item["id"] == document_id)


def _source_by_id(source_id: str) -> dict[str, Any]:
    return next(item for item in KNOWLEDGE_SOURCES if item["id"] == source_id)


def _chunk_payload(chunk: dict[str, Any], score: float | None = None) -> dict[str, Any]:
    document = _document_by_id(chunk["document_id"])
    source = _source_by_id(document["source_id"])
    payload = {
        **chunk,
        "document_title": document["title"],
        "document_type": document["doc_type"],
        "document_summary": document["summary"],
        "source_name": source["name"],
        "source_type": source["type"],
        "linked_objects": document["linked_objects"],
    }
    if score is not None:
        payload["score"] = round(float(score), 4)
    return payload


def _card_payload(card: dict[str, Any]) -> dict[str, Any]:
    space = next((item for item in KNOWLEDGE_SPACES if item["id"] == card["space_id"]), None)
    evidence = []
    for ref in card["evidence_refs"]:
        document = _document_by_id(ref["document_id"])
        source = _source_by_id(document["source_id"])
        evidence.append({
            **ref,
            "document_title": document["title"],
            "document_type": document["doc_type"],
            "source_name": source["name"],
            "source_type": source["type"],
        })
    return {
        **card,
        "space_name": space["name"] if space else card["space_id"],
        "evidence_refs": evidence,
    }


@lru_cache(maxsize=1)
def _retriever():
    corpus = [
        f"{_document_by_id(chunk['document_id'])['title']} {_document_by_id(chunk['document_id'])['summary']} {chunk['chunk_text']}"
        for chunk in KNOWLEDGE_CHUNKS
    ]
    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))
    matrix = vectorizer.fit_transform(corpus)
    return vectorizer, matrix


def _matches_object(document: dict[str, Any], object_type: str | None, object_id: str | None) -> bool:
    if not object_type and not object_id:
        return True
    normalized_id = (object_id or "").lower()
    normalized_type = (object_type or "").lower()
    for linked in document["linked_objects"]:
        if normalized_type and linked["type"].lower() != normalized_type:
            continue
        if not normalized_id:
            return True
        if normalized_id in linked["id"].lower() or normalized_id in linked["name"].lower():
            return True
    return False


def _matches_card(card: dict[str, Any], object_type: str | None, object_id: str | None) -> bool:
    if not object_type and not object_id:
        return True
    normalized_id = (object_id or "").lower()
    normalized_type = (object_type or "").lower()
    for linked in card["linked_objects"]:
        if normalized_type and linked["type"].lower() != normalized_type:
            continue
        if not normalized_id:
            return True
        if normalized_id in linked["id"].lower() or normalized_id in linked["name"].lower():
            return True
    return False


@router.get("/sources")
async def list_sources():
    return {"data": KNOWLEDGE_SOURCES}


@router.get("/spaces")
async def list_spaces():
    return {"data": KNOWLEDGE_SPACES}


@router.get("/documents")
async def list_documents(source_id: str | None = None):
    documents = KNOWLEDGE_DOCUMENTS
    if source_id:
        documents = [item for item in documents if item["source_id"] == source_id]
    ingested = [
        {
            "id": item["document_id"],
            "source_id": "uploaded",
            "title": item["title"],
            "doc_type": item["source_type"],
            "status": item["status"],
            "updated_at": item["updated_at"],
            "summary": f"Uploaded knowledge asset: {item['source_file_name']}",
            "linked_objects": [],
        }
        for item in INGESTED_DOCUMENTS.values()
    ]
    return {"data": [*documents, *ingested]}


@router.post("/assets/upload")
async def upload_knowledge_asset(
    file: UploadFile = File(...),
    permission_scope: str = "enterprise",
    owner_user_id: str = "demo-user",
):
    content = await file.read()
    result = ingest_asset(
        file_name=file.filename or "uploaded-asset",
        content=content,
        owner_user_id=owner_user_id,
        permission_scope=permission_scope,
    )
    await persist_ingestion_result(result)
    if result["job"]["status"] == "failed":
        return {"data": result, "ok": False}
    return {"data": result, "ok": True}


@router.post("/extraction-jobs")
async def create_knowledge_extraction_job(
    file: UploadFile = File(...),
    domain: str = Form("manufacturing"),
    prompt_name: str = Form("manufacturing_ontology_v1"),
    model_name: str = Form("mock-chat"),
    permission_scope: str = Form("enterprise"),
    owner_user_id: str = Form("demo-user"),
):
    content = await file.read()
    try:
        result = await create_extraction_job(
            file_name=file.filename or "uploaded-asset",
            content=content,
            domain=domain,
            prompt_name=prompt_name,
            model_name=model_name,
            owner_user_id=owner_user_id,
            permission_scope=permission_scope,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"data": result, "ok": True}


@router.get("/extraction-jobs/{job_id}")
async def get_knowledge_extraction_job(job_id: str):
    job = await get_extraction_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Knowledge extraction job not found")
    return {"data": job}


@router.post("/extraction-jobs/{job_id}/approve")
async def approve_knowledge_extraction_job(job_id: str, body: ExtractionApproveBody | None = None):
    job = await approve_extraction_job(job_id, body.approved_result if body else None)
    if not job:
        raise HTTPException(status_code=404, detail="Knowledge extraction job not found")
    return {"data": job, "ok": job["status"] != "blocked"}


@router.post("/extraction-jobs/{job_id}/commit-to-graph")
async def commit_knowledge_extraction_job_to_graph(job_id: str):
    try:
        result = await commit_extraction_to_graph(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=404, detail="Knowledge extraction job not found")
    return {"data": result, "ok": True}


@router.get("/extraction-jobs/{job_id}/export")
async def export_knowledge_extraction_job(job_id: str, format: str = "json"):
    job = await get_extraction_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Knowledge extraction job not found")
    try:
        media_type, suffix, content = export_extraction(job, format)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    headers = {"Content-Disposition": f'attachment; filename="{job_id}.{suffix}"'}
    return Response(content=content, media_type=media_type, headers=headers)


@router.get("/ingestion-jobs/{job_id}")
async def get_ingestion_job(job_id: str):
    job = INGESTION_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Knowledge ingestion job not found")
    return {"data": job}


@router.get("/documents/{document_id}")
async def get_document(document_id: str):
    ingested = INGESTED_DOCUMENTS.get(document_id)
    if ingested:
        return {"data": ingested}
    document = next((item for item in KNOWLEDGE_DOCUMENTS if item["id"] == document_id), None)
    if not document:
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    return {"data": document}


@router.get("/documents/{document_id}/markdown")
async def get_document_markdown(document_id: str):
    ingested = INGESTED_DOCUMENTS.get(document_id)
    if not ingested:
        raise HTTPException(status_code=404, detail="Markdown document not found")
    return {
        "data": {
            "document_id": document_id,
            "markdown_content": ingested["markdown_content"],
            "source_file_name": ingested["source_file_name"],
        }
    }


@router.get("/documents/{document_id}/chunks")
async def list_document_chunks(document_id: str):
    if document_id in INGESTED_DOCUMENTS:
        chunks = [chunk for chunk in INGESTED_CHUNKS.values() if chunk["document_id"] == document_id]
        return {"data": chunks}
    if not any(item["id"] == document_id for item in KNOWLEDGE_DOCUMENTS):
        raise HTTPException(status_code=404, detail="Knowledge document not found")
    chunks = [chunk for chunk in KNOWLEDGE_CHUNKS if chunk["document_id"] == document_id]
    return {"data": [_chunk_payload(chunk) for chunk in chunks]}


@router.get("/cards")
async def list_cards(space_id: str | None = None, status: str | None = None):
    cards = KNOWLEDGE_CARDS
    if space_id:
        cards = [item for item in cards if item["space_id"] == space_id]
    if status:
        cards = [item for item in cards if item["status"] == status]
    return {"data": [_card_payload(card) for card in cards]}


@router.get("/cards/{card_id}")
async def get_card(card_id: str):
    card = next((item for item in KNOWLEDGE_CARDS if item["id"] == card_id), None)
    if not card:
        raise HTTPException(status_code=404, detail="Knowledge card not found")
    return {"data": _card_payload(card)}


@router.get("/related-cards")
async def get_related_cards(object_type: str | None = None, object_id: str | None = None, limit: int = 4):
    cards = [
        _card_payload(card)
        for card in KNOWLEDGE_CARDS
        if _matches_card(card, object_type, object_id)
    ]
    return {"data": cards[: max(1, min(limit, 10))]}


@router.post("/binding-candidates")
async def suggest_binding_candidates(body: BindingCandidateBody):
    text = body.text.strip().lower()
    if not text:
        raise HTTPException(status_code=400, detail="Binding text cannot be empty")

    results = []
    for candidate in DATA_CLEANING_CANDIDATES:
        haystack = " ".join([
            candidate["text"],
            candidate["object_type"],
            candidate["object_id"],
            candidate["object_name"],
            *candidate["alias"],
        ]).lower()
        if any(token and token in haystack for token in text.split()) or candidate["text"].lower() in text:
            results.append(candidate)

    if not results:
        results = sorted(DATA_CLEANING_CANDIDATES, key=lambda item: item["confidence"], reverse=True)[:3]

    return {"data": results[: max(1, min(body.limit, 20))]}


@router.get("/ocr-pipeline")
async def get_ocr_pipeline():
    return {"data": OCR_PIPELINE_STEPS}


@router.get("/related")
async def get_related_knowledge(object_type: str | None = None, object_id: str | None = None, limit: int = 4):
    matched_documents = [
        document
        for document in KNOWLEDGE_DOCUMENTS
        if _matches_object(document, object_type, object_id)
    ]
    related = []
    for document in matched_documents:
        chunks = [chunk for chunk in KNOWLEDGE_CHUNKS if chunk["document_id"] == document["id"]]
        first_chunk = chunks[0] if chunks else None
        source = _source_by_id(document["source_id"])
        related.append({
            **document,
            "source_name": source["name"],
            "source_type": source["type"],
            "source_ref": first_chunk["source_ref"] if first_chunk else document["title"],
            "chunk_text": first_chunk["chunk_text"] if first_chunk else document["summary"],
            "score": 0.88 if object_type or object_id else 0.72,
        })
    return {"data": related[: max(1, min(limit, 10))]}


@router.post("/search")
async def search_knowledge(body: KnowledgeSearchBody):
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query cannot be empty")

    vectorizer, matrix = _retriever()
    query_vector = vectorizer.transform([query])
    scores = cosine_similarity(query_vector, matrix).flatten()
    ranked = sorted(enumerate(scores), key=lambda item: item[1], reverse=True)

    results = []
    for item in search_ingested_knowledge(query, limit=body.limit):
        results.append(item)

    for index, score in ranked:
        if score <= 0:
            continue
        chunk = KNOWLEDGE_CHUNKS[index]
        document = _document_by_id(chunk["document_id"])
        if not _matches_object(document, body.object_type, body.object_id):
            continue
        payload = _chunk_payload(chunk, float(score))
        payload.setdefault("snippet", payload.get("chunk_text", "")[:300])
        payload.setdefault("source_location", payload.get("source_ref", "demo-source"))
        results.append(payload)
        if len(results) >= max(1, min(body.limit, 10)):
            break

    return {
        "data": {
            "query": query,
            "answer": "已根据本地知识库检索到相关 SOP、历史 CAPA 或供应商证据，MVP 阶段返回候选引用，由业务用户确认后再进入流程。",
            "results": results,
        }
    }
