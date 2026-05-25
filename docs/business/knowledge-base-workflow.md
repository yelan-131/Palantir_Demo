# Knowledge Base Workflow

Last updated: 2026-05-25

## What Users Do

The knowledge base has three user journeys.

The management entry is a first-level tab in Account Center:

```text
账号中心 / 工作偏好 / AI 与平台设置 / 应用与菜单 / 数据资产与本体 / 知识库中心
```

It is intentionally not nested under Data Assets And Ontology, because knowledge
governance covers personal, team, department, and enterprise material. Data
Assets And Ontology remains the place for structured assets and object models.

## 1. Upload And Prepare

Uploader roles:

- quality engineer;
- SQE / purchasing quality engineer;
- equipment engineer;
- process engineer;
- customer quality owner.

Flow:

```text
Choose knowledge space
  -> upload raw material
  -> choose source type
  -> add title and department
  -> run OCR / text extraction
  -> submit AI compilation
```

Personal notes can stay private. Department and enterprise knowledge must go
through review before it appears in business workbenches.

## 2. Review And Publish

Reviewer roles:

- quality manager;
- quality system owner;
- SQE lead;
- equipment supervisor;
- process owner;
- platform admin for cross-domain publishing.

Reviewer checks:

- whether the knowledge card is correct;
- whether the source evidence is reliable;
- whether OCR low-confidence fields were corrected;
- whether object binding is correct;
- whether permissions are suitable;
- whether the card can be used by task workbenches.

Review outcomes:

```text
Approve -> published
Return -> uploader edits or adds evidence
Archive -> no longer recommended in workbenches
```

## 3. Use In Workbench

Workbench users do not need to search documents manually.

Example in quality exception handling:

```text
User clicks "MaterialBatch: MB-7781"
  -> system finds cards linked to MB-7781
  -> right panel shows supplier batch risk and solder void strategy
  -> user confirms action: freeze batch / create CAPA / reinspect
```

Knowledge is consumed as cards:

- applicable scenario;
- recommended actions;
- risk notes;
- evidence references;
- linked objects.

## Binding Responsibility

| Stage | Who binds | How |
| --- | --- | --- |
| MVP | Platform admin / business expert | Manual object selection |
| Early rollout | Uploader + reviewer | AI recommends, user confirms |
| Mature rollout | System + data steward | Entity extraction, master data matching, batch confirmation |

## Data Cleaning Tips

Make cleaning efficient by focusing on batches, not one-by-one editing.

Recommended UI features:

- high-confidence candidate batch confirmation;
- low-confidence queue;
- alias dictionary;
- duplicate object merge;
- conflict detection;
- source evidence preview;
- audit trail for every confirmed link.

Common aliases:

```text
北辰电子材料 / 北辰材料 / Beichen / SUP-BEICHEN
SMT-03 / SMT03 / 三号回流炉
焊点虚焊 / 空焊 / BGA 焊接不良
```

## OCR Handling

OCR is a draft-generation step, not a final authority.

Always review:

- dates;
- quantities;
- percentages;
- batch codes;
- supplier names;
- handwritten notes;
- signatures and seals.

Only reviewed content should be promoted into department or enterprise
knowledge spaces.
