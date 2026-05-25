# Graph Database Integration

Last updated: 2026-05-23

## Summary

The quality closure graph is moving from a fixed frontend demo graph to a
Graph Service driven view.

Responsibilities:

- PostgreSQL / business APIs remain the source of truth for transactional data.
- Neo4j stores relationship indexes, impact paths, and traceability paths.
- The knowledge base stores evidence and reusable knowledge cards.
- The frontend consumes a unified graph payload and does not query Neo4j
  directly.

## Object ID Contract

Every object that appears in the graph needs a stable string id.

Examples:

```text
quality-event-qe-20260521-001
defect-001
inspection-batch-ipqc-260521-088
material-batch-mb-7781
supplier-s-023
workorder-260521-017
equipment-smt-03
customer-order-so-8821
capa-072
```

The same object id should be used across:

- business tables/API responses;
- Neo4j node `id`;
- knowledge card `linked_objects`;
- workflow/action payloads.

## Quality Closure Relationship Model

Minimum Neo4j relationships for the first real integration:

```text
QualityEvent -[:HAS_DEFECT]-> Defect
Defect -[:FOUND_IN]-> InspectionBatch
InspectionBatch -[:INSPECTS]-> MaterialBatch
MaterialBatch -[:SUPPLIED_BY]-> Supplier
WorkOrder -[:USES_BATCH]-> MaterialBatch
WorkOrder -[:USES_EQUIPMENT]-> Equipment
WorkOrder -[:AFFECTS_ORDER]-> CustomerOrder
QualityEvent -[:TRIGGERS]-> CAPA
KnowledgeCard -[:EVIDENCE_FOR]-> Defect/Supplier/Equipment/MaterialBatch
```

## API Contract

Current MVP endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/graph/sync/quality-demo` | Upsert quality demo nodes and edges into Neo4j |
| `GET` | `/api/v1/graph/impact-analysis-by-object` | Query impact graph by business object type/id |
| `GET` | `/api/v1/quality/events/{event_id}/impact` | Quality page graph payload, graph-first with fallback |

Impact payload shape:

```json
{
  "event": {},
  "root": {},
  "nodes": [],
  "edges": [],
  "summary": {},
  "source": "neo4j"
}
```

If Neo4j is unavailable or empty, `source` becomes `fallback` and the existing
demo graph remains active.

## Data Flow

```text
Demo / seed business data
  -> graph sync service
  -> Neo4j MERGE nodes and relationships
  -> quality impact endpoint
  -> frontend graph canvas
  -> right panel object detail + knowledge cards
```

Future real data flow:

```text
MES / ERP / QMS / WMS
  -> data cleaning and object-id normalization
  -> graph sync / event-driven updates
  -> Neo4j relationship graph
  -> workbench impact analysis
```

## Frontend Behavior

The quality workbench keeps the current visual style:

- left: task list;
- center: graph canvas;
- right: selected object details, knowledge cards, and action buttons;
- bottom: task timeline.

The graph canvas now accepts graph API nodes and edges. The current fixed layout
is kept for the first nine nodes; additional nodes use a simple overflow grid as
a temporary fallback before a future graph layout engine is introduced.

## Next Phase

After the demo sync is stable, the next work should focus on:

- master-data alias management;
- batch graph synchronization from real tables;
- incremental graph events;
- permission filtering by role;
- graph layout engine for larger subgraphs;
- node detail aggregation from PostgreSQL + Neo4j + knowledge base.
