# Knowledge Base Architecture

Last updated: 2026-05-25

Source of truth:

- `backend/app/api/knowledge.py`
- `frontend/src/pages/SystemAdmin/SemanticAssetCenter.tsx`
- `frontend/src/pages/QualityImpact/index.tsx`
- `frontend/src/services/api.ts`

Status: current API MVP plus target architecture notes. Sections labeled
**Target** describe planned persistent/vector storage, not current runtime
infrastructure.

## Product Position

The knowledge base is not only a document search feature. It is the layer that
turns enterprise materials into task-ready evidence.

The intended chain is:

```text
原始资料
  -> OCR / 文本解析
  -> 实体抽取与主数据匹配
  -> AI 编译成知识条目草稿
  -> 人工审核发布
  -> 绑定业务对象
  -> 质量异常等工作台自动调用
```

For retrieval-backed AI, the target technical ingestion chain is:

```text
raw file
  -> Markdown normalization
  -> chunking with source metadata
  -> embedding through backend provider adapter
  -> pgvector-ready vector rows
  -> RAG retrieval
  -> cited answer, draft, or workbench evidence
```

The raw file remains the evidence source of record. Markdown is the normalized,
reviewable intermediate representation used for chunking, evidence previews,
and human correction. Embeddings are derived retrieval artifacts and can be
regenerated when the embedding model, chunking strategy, or source document
version changes.

The UI should not expose "chunks" as the main user-facing concept. Chunking can
remain an internal retrieval implementation, but business users should see:

- knowledge spaces;
- source documents;
- knowledge cards;
- evidence references;
- linked business objects;
- binding and cleaning suggestions.

## Knowledge Levels

Knowledge is split into four levels.

| Level | Owner | Visibility | Review | Typical Content |
| --- | --- | --- | --- | --- |
| Personal | Current user | Private | No | Personal notes, temporary material, private learning |
| Team | Team members | Team | Optional/required by team | Project experience, issue notes, shared drafts |
| Department | Department knowledge owner | Department roles | Required | SOP, CAPA, problem library, department standards |
| Enterprise | Platform admin / business experts | Authorized cross-functional users | Required | Official policy, audited process, reusable operating knowledge |

Promotion path:

```text
个人沉淀 -> 团队复用 -> 部门审核 -> 企业发布 -> 工作台引用
```

## Roles

| Role | Responsibility |
| --- | --- |
| Knowledge uploader | Uploads raw material, selects knowledge source, adds initial metadata, submits for AI compilation |
| Knowledge maintainer | Edits AI-generated knowledge card drafts, corrects OCR output, adds missing object links |
| Knowledge reviewer | Checks business correctness, evidence sources, linked objects, permissions, and publishes or rejects |
| Data steward | Handles entity matching, alias management, duplicate merging, and low-confidence bindings |
| Knowledge user | Consumes published knowledge inside task workbenches, without maintaining backend knowledge |
| Platform admin | Configures spaces, source categories, permissions, object types, workflow rules, and audit policies |

## Storage Model

The MVP keeps data in code-level demo arrays, but the target persistent model is:

| Concept | Purpose |
| --- | --- |
| `knowledge_spaces` | Personal/team/department/enterprise spaces |
| `knowledge_sources` | Source categories such as SOP, CAPA, supplier report, equipment log |
| `knowledge_documents` | Original uploaded or synchronized documents |
| `knowledge_cards` | Obsidian-style business knowledge entries |
| `knowledge_evidence_refs` | Evidence references back to original documents or sections |
| `knowledge_object_links` | Links from cards/evidence to ontology objects |
| `knowledge_binding_candidates` | AI/data-cleaning suggestions before confirmation |
| `knowledge_permissions` | Role and scope rules |
| `knowledge_audit_logs` | Upload, OCR correction, AI generation, review, publish, and usage logs |

Internal retrieval can still use chunks or embeddings:

```text
source document -> Markdown -> internal chunk/index/embedding -> retrieval candidate
```

Current implementation:

```text
demo arrays
  -> upload simulation
  -> ingestion-job status
  -> normalized Markdown response
  -> chunk/card metadata
  -> TF-IDF retrieval
```

Target vector implementation:

```text
original file
  -> Markdown conversion
  -> chunk records with source location and permission scope
  -> deterministic demo embedding vector
  -> vector-shaped search result
```

When PostgreSQL + pgvector is enabled, the in-memory/demo chunk and embedding store
should be replaced by persistent `knowledge_documents`, `knowledge_chunks`, and
`knowledge_embeddings` tables without changing the public API shape.

Target vector-row shape:

| Field | Purpose |
| --- | --- |
| `chunk_id` | Stable chunk identifier, usually derived from document version and chunk hash |
| `document_id` / `document_version` | Link back to the original uploaded or synchronized source |
| `markdown_path` | Pointer to the normalized Markdown artifact or section |
| `source_locator` | Page, sheet, heading, paragraph, or OCR region used for citation |
| `content` | Chunk text used for retrieval and answer grounding |
| `embedding_model` | Model used to generate the vector |
| `embedding` | pgvector-compatible dense vector |
| `metadata` | JSON metadata such as source type, language, object links, review state, permissions |
| `permission_scope` | Space/team/department/enterprise visibility filter |
| `content_hash` | Idempotency and re-ingestion comparison |

But the user-facing artifact should be:

```text
knowledge card -> scenario / guidance / risk notes / evidence / linked objects
```

## Binding To Business Data

Knowledge is useful only when it is connected to business objects.

Example knowledge card:

```text
焊点虚焊处理策略
```

Linked objects:

```text
Defect: 焊点虚焊
MaterialBatch: MB-7781 / 焊锡膏 S12
Supplier: 北辰电子材料
Equipment: SMT-03 回流焊
WorkOrder: WO-260521-017
```

### Early Binding

MVP and early rollout should use human-confirmed binding:

```text
上传者初步选择对象
  -> AI 推荐候选对象
  -> 审核者确认
  -> 写入知识对象关系
```

UI expectations:

- select object type;
- search object by name/code;
- show candidate confidence;
- allow confirm/ignore/replace;
- keep evidence source visible.

### Mature Binding

Later versions should automate most binding:

```text
OCR / 文本解析
  -> entity extraction
  -> ERP/MES/QMS/设备台账 matching
  -> alias and duplicate handling
  -> high-confidence batch confirmation
  -> low-confidence data steward review
```

Data cleaning should support:

- exact match;
- code match;
- semantic match;
- alias dictionary;
- duplicate merge;
- batch confirm;
- conflict queue;
- audit trail.

## OCR Flow

OCR is the entry point for scanned PDFs, images, inspection sheets, supplier
reports, and handwritten field records.

Recommended flow:

```text
资料上传
  -> file type detection
  -> OCR text extraction
  -> layout analysis
  -> table extraction
  -> low-confidence field marking
  -> human correction
  -> entity extraction
  -> knowledge card draft
  -> review and publish
```

OCR output must not be published directly as enterprise knowledge. It should be
reviewed, especially for:

- numbers and percentages;
- material and batch codes;
- supplier names;
- signatures and seals;
- dates;
- handwritten fields.

## Markdown, Embedding, And RAG Flow

The ingestion pipeline should treat every source format as a candidate for a
common Markdown representation:

| Source type | Markdown normalization notes |
| --- | --- |
| PDF / Word | Preserve headings, paragraphs, tables, page references, and document title |
| Spreadsheet | Convert relevant sheets and ranges into Markdown tables with sheet/range metadata |
| Image / scanned PDF | Use OCR text plus layout hints and confidence markers |
| Plain text / copied notes | Preserve author, timestamp, source space, and explicit object links |

After Markdown normalization:

1. Chunk by semantic section first, then by token/length limits.
2. Attach source metadata to every chunk before embedding.
3. Generate embeddings only through the backend provider adapter.
4. Store vectors in a pgvector-ready schema with permission and review metadata.
5. Retrieve by vector similarity plus filters for space, permission, object type,
   review state, and source category.
6. Return evidence references to the AI assistant and UI, not just answer text.

This keeps the user-facing path simple:

```text
uploaded file -> reviewed Markdown/evidence -> answer with citations
```

And keeps the backend path ready for production RAG:

```text
document row -> chunk rows -> embedding rows -> pgvector query -> rerank -> cited context
```

## Current MVP Implementation

Backend endpoints under `/api/v1/knowledge`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/spaces` | List personal/team/department/enterprise spaces |
| `GET` | `/sources` | List knowledge source categories |
| `GET` | `/documents` | List original source documents |
| `POST` | `/assets/upload` | Simulate knowledge asset upload and start a demo ingestion job |
| `GET` | `/ingestion-jobs/{job_id}` | Get demo ingestion job status |
| `GET` | `/documents/{document_id}` | Get one source document |
| `GET` | `/documents/{document_id}/markdown` | Return normalized Markdown for a document |
| `GET` | `/documents/{document_id}/chunks` | Internal evidence chunks for compatibility |
| `GET` | `/cards` | List knowledge cards |
| `GET` | `/cards/{card_id}` | Get one knowledge card |
| `GET` | `/related-cards` | Return knowledge cards linked to a business object |
| `POST` | `/binding-candidates` | Suggest object bindings for cleaning/confirmation |
| `GET` | `/ocr-pipeline` | Return the OCR and publishing pipeline |
| `GET` | `/related` | Legacy evidence lookup |
| `POST` | `/search` | Local TF-IDF retrieval for RAG-shaped search |

Target ingestion endpoints or service operations should align with the Agent
tool contract:

| Operation | Purpose |
| --- | --- |
| `knowledge.ingest_document` | Register the uploaded or synchronized raw file and source metadata |
| `knowledge.convert_to_markdown` | Create the normalized Markdown representation |
| `knowledge.chunk_markdown` | Produce stable chunks with source locators and permission metadata |
| `knowledge.embed_chunks` | Generate backend-hosted embeddings and store pgvector-ready rows |
| `knowledge.search` | Retrieve cards and chunks as RAG evidence for assistants and workbenches |

The MVP may expose these as internal service steps before they become public
HTTP endpoints.

Frontend surfaces:

- Account Center -> Knowledge Center
- Account Center -> Data Assets And Ontology remains focused on structured data, ontology objects, and page contracts
- Quality Event Workbench right-side related knowledge cards

## Implementation Principle

Use a hybrid approach:

```text
Traditional RAG
  -> fast ingestion and retrieval for raw material

Obsidian-style knowledge cards
  -> stable business knowledge for task workbenches
```

This keeps the system practical:

- raw material becomes searchable quickly;
- high-value recurring knowledge is compiled and reviewed;
- business users consume clean cards instead of raw chunks;
- every AI suggestion can point back to evidence.
