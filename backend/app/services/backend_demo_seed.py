"""Additive, repeatable local data for the backend settings workbenches.

Run inside the demo backend: python -m app.services.backend_demo_seed
Existing records are never truncated. Only this seed's named examples are added.
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal, _engine, neo4j_driver
from app.models import relational as m

SEED_KEY = "backend-settings-demo-v1"
SCENARIOS = [
    ("焊点虚焊", "critical", "open", "AOI 抽检 120 件发现 8 件虚焊；回流焊温区 5 超出控制上限，关联锡膏批次 MB-7781。"),
    ("压铸壳体孔位尺寸漂移", "major", "in_progress", "SPC 出现连续 7 点偏移，孔位尺寸超差 0.06 mm；已隔离批次并安排设备定位精度复核。"),
    ("端子压接高度偏差", "minor", "closed", "压接高度偏差已通过模具补偿和复检消除，200 件复检全部合格，CAPA 已关闭。"),
]


async def ensure(db, model_class, lookup: dict, **values):
    row = await db.scalar(select(model_class).filter_by(**lookup))
    if row is None:
        row = model_class(**lookup, **values)
        db.add(row)
        await db.flush()
    return row


async def seed_relational(tenant_id: int = 1):
    if settings.IS_PRODUCTION:
        raise RuntimeError("Example seeding is limited to non-production environments")
    models = [m.Factory, m.Workshop, m.ProductionLine, m.Equipment, m.Sensor, m.SensorReading,
              m.Product, m.Material, m.Supplier, m.Customer, m.Worker, m.SalesOrder,
              m.WorkOrder, m.Inspection, m.Defect, m.CAPA, m.SPCPoint]
    async with _engine.begin() as connection:
        await connection.run_sync(lambda sync: m.Base.metadata.create_all(sync, tables=[model.__table__ for model in models], checkfirst=True))
    scenarios = []
    async with AsyncSessionLocal() as db:
        if not await db.get(m.Tenant, tenant_id):
            raise ValueError("Tenant does not exist")
        async def add(model_class, name, **values):
            return await ensure(db, model_class, {"tenant_id": tenant_id, "name": name}, **values)
        factory = await add(m.Factory, "示例·上海电子制造一厂", location="上海（示例）", capacity=12000, status="active", description=SEED_KEY)
        workshop = await add(m.Workshop, "示例·SMT 与精密装配车间", factory_id=factory.id, area=2400, workshop_type="production")
        line = await add(m.ProductionLine, "示例·电子控制模块产线", workshop_id=workshop.id, capacity=2400, oee_target=0.85, status="running")
        worker = await add(m.Worker, "示例·质量检验员", role="quality_inspector", department="质量管理部")
        customer = await add(m.Customer, "示例·华东汽车电子", industry="汽车电子", region="华东")
        product = await ensure(db, m.Product, {"tenant_id": tenant_id, "sku": "DEMO-ECU-V2"}, name="示例·电控模块 V2", category="电子控制器", unit="件")
        source = await add(m.DataSource, "示例·本地制造业务库", source_type="postgresql", status="connected", connection_config=json.dumps({
            "host": settings.POSTGRES_HOST, "port": settings.POSTGRES_PORT, "database": settings.POSTGRES_DB,
            "username": settings.POSTGRES_USER, "password": settings.POSTGRES_PASSWORD,
            "selected_tables": ["equipment", "sensors", "sensor_readings", "materials", "work_orders", "inspections", "defects", "capa"],
        }))
        for index, (defect_type, severity, capa_status, description) in enumerate(SCENARIOS):
            moment = datetime(2026, 5, 21, 9, 40) + timedelta(minutes=index * 38)
            machine = await add(m.Equipment, ["SMT-03", "CNC-08", "PRESS-02"][index] + "（示例）", line_id=line.id, model=["回流焊炉", "精密加工中心", "端子压接机"][index], manufacturer="示例制造商", status="running", health_score=[72, 81, 96][index])
            material = await add(m.Material, ["锡膏 S12", "铝合金壳体", "连接端子"][index] + "（示例）", material_type="production", unit="件", safety_stock=500)
            supplier = await add(m.Supplier, ["北辰电子材料", "华东精密铸造", "南方连接技术"][index] + "（示例）", location="中国（示例）", rating=4.2, lead_time_days=7, contact="示例联系人")
            order = await ensure(db, m.SalesOrder, {"tenant_id": tenant_id, "order_no": f"DEMO-SO-{8821+index}"}, customer_id=customer.id, product_id=product.id, quantity=1200, due_date=moment+timedelta(days=3), priority="high", status="in_progress")
            work = await ensure(db, m.WorkOrder, {"tenant_id": tenant_id, "order_no": f"DEMO-WO-260521-{17+index:03}"}, sales_order_id=order.id, line_id=line.id, planned_start=moment-timedelta(hours=2), planned_end=moment+timedelta(hours=6), actual_start=moment-timedelta(hours=1), quantity=1200, completed_quantity=[380, 620, 1200][index], status="completed" if index==2 else "in_progress")
            inspection = await ensure(db, m.Inspection, {"tenant_id": tenant_id, "inspection_type": "in_process", "target_type": "WorkOrder", "target_id": work.id}, result="fail", inspector_id=worker.id, inspected_at=moment)
            defect = await ensure(db, m.Defect, {"tenant_id": tenant_id, "inspection_id": inspection.id, "defect_type": defect_type}, severity=severity, description="【示例数据】"+description, root_cause="温区偏移 / 工装磨损，待证据复核" if index<2 else "模具补偿参数偏差", correction="隔离批次、复检、工艺参数复核" if index<2 else "已调整补偿并完成复检")
            capa = await ensure(db, m.CAPA, {"tenant_id": tenant_id, "defect_id": defect.id, "action_type": "corrective"}, description=f"示例·{defect_type}纠正预防措施", status=capa_status, due_date=moment+timedelta(days=3), assignee_id=worker.id)
            sensor = await add(m.Sensor, f"示例·{machine.name}监测", equipment_id=machine.id, sensor_type="temperature" if index==0 else "dimension", unit="℃" if index==0 else "mm", sampling_rate=60)
            for minute in range(61):
                timestamp = moment-timedelta(minutes=30)+timedelta(minutes=minute)
                value = (245 + ((minute%7)-3)*0.3 + (8 if 20 <= minute <= 38 else 0)) if index==0 else round(10 + ((minute%5)-2)*0.003 + (0.06 if 20<=minute<=38 and index==1 else 0), 3)
                await ensure(db, m.SensorReading, {"tenant_id": tenant_id, "sensor_id": sensor.id, "timestamp": timestamp}, value=value)
                await ensure(db, m.SPCPoint, {"tenant_id": tenant_id, "equipment_id": machine.id, "parameter": "reflow_temperature" if index==0 else f"demo_dimension_{index}", "timestamp": timestamp}, value=value, ucl=250 if index==0 else 10.03, lcl=240 if index==0 else 9.97, cl=245 if index==0 else 10)
            scenarios.append({"index": index, "moment": moment, "defect": defect.id, "inspection": inspection.id, "equipment": machine.id, "sensor": sensor.id, "material": material.id, "supplier": supplier.id, "work": work.id, "order": order.id, "capa": capa.id, "status": capa_status})
        for name in ["示例·质量检验数据采集", "示例·设备时序证据汇总", "示例·物料批次关系同步"]:
            await add(m.Pipeline, name, description="示例管道配置；尚未执行外部同步。", config=json.dumps({"source_id": source.id, "seed_key": SEED_KEY}), status="draft", schedule=None)
        for name, job_type in [("示例·每日质量复盘", "report"), ("示例·设备健康检查", "sync")]:
            await add(m.ScheduledJob, name, cron="0 8 * * *", job_type=job_type, config=json.dumps({"seed_key": SEED_KEY}), is_active=False)
        await db.commit()
    return scenarios, source.id


async def seed_graph(scenarios: list[dict], tenant_id: int = 1):
    from app.api.quality import QUALITY_EVENT_DEMO
    from app.api.graph import QUALITY_EDGE_REL_MAP, normalize_quality_event_graph_id
    from app.services.graph_service import graph_service
    from app.api.knowledge import KNOWLEDGE_CARDS
    await graph_service.ensure_business_constraints()
    node_count = edge_count = 0
    for scenario in scenarios:
        index = scenario["index"]
        event_id = f"QD-{scenario['defect']}"
        nodes = copy.deepcopy(QUALITY_EVENT_DEMO["nodes"])
        ids = {node["id"]: f"backend-demo-t{tenant_id}-s{index}-{node['id']}" for node in nodes}
        ids["event-qe-001"] = normalize_quality_event_graph_id(event_id)
        stage = {"Supplier": -70, "MaterialBatch": -60, "InventoryLot": -50, "WorkOrder": -40, "Equipment": -35, "Sensor": -32, "Operation": -30, "TimeSeriesWindow": -10, "ProductBatch": -5, "InspectionBatch": 0, "Defect": 1, "QualityEvent": 2, "CustomerOrder": 5, "CAPA": 15}
        async with neo4j_driver.session() as session:
            for number, node in enumerate(nodes):
                raw = node["id"]
                time = scenario["moment"]+timedelta(minutes=stage.get(node["type"], 0))
                props = {**node, "id": ids[raw], "source_id": node["name"], "tenant_id": tenant_id, "source_system": SEED_KEY,
                         "pg_id": 810000+index*100+number, "occurred_at": time.isoformat(), "seed_key": SEED_KEY}
                if node["type"] == "QualityEvent":
                    props.update(source_id=event_id, name=f"{event_id} · {SCENARIOS[index][0]}", status="closed" if index==2 else "open", summary=SCENARIOS[index][3])
                if index:
                    props["risk"] = "low" if index==2 else "major"
                    props["status"] = "closed" if index==2 else "in_progress"
                    props["name"] = f"示例{index+1}·{node['label']}"
                    props["summary"] = f"{SCENARIOS[index][0]}的{node['label']}记录，关联示例工单 DEMO-WO-260521-{17+index:03}。"
                    props["source_id"] = ids[raw]
                    if node["type"] == "QualityEvent": props.update(source_id=event_id, name=f"{event_id} · {SCENARIOS[index][0]}")
                await graph_service.upsert_business_node(node["type"], ids[raw], props)
                for version, status in enumerate(["待检", "异常隔离", "复检通过" if index==2 else "处置中"]):
                    valid_from = time+timedelta(minutes=version*15)
                    await session.run("MATCH (n {id: $id}) MERGE (v:EntityVersion {id: $version_id}) SET v.valid_from=$time, v.status=$status, v.name=$name, v.tenant_id=$tenant MERGE (n)-[:VERSION_OF]->(v)", id=ids[raw], version_id=ids[raw]+f"-v{version}", time=valid_from.isoformat(), status=status, name=props["name"], tenant=tenant_id)
                node_count += 1
            for edge in QUALITY_EVENT_DEMO["edges"]:
                kind, raw_source, raw_target = QUALITY_EDGE_REL_MAP[edge["id"]]
                source_node = next(node for node in nodes if node["id"]==raw_source)
                target_node = next(node for node in nodes if node["id"]==raw_target)
                time = scenario["moment"]+timedelta(minutes=max(stage.get(source_node["type"],0),stage.get(target_node["type"],0)))
                await graph_service.upsert_business_edge(ids[raw_source], ids[raw_target], kind, {"label": edge["label"], "source_system": SEED_KEY, "occurred_at": time.isoformat()})
                edge_count += 1
            # Direct event links keep the complete supply/production chain within three hops.
            for raw in ["material-batch-mb-7781", "workorder-260521-017", "order-so-8821"]:
                await graph_service.upsert_business_edge(ids["event-qe-001"], ids[raw], "RELATED_TO", {"label": "影响关联", "source_system": SEED_KEY, "occurred_at": (scenario["moment"]+timedelta(minutes=3)).isoformat()})
                edge_count += 1
            if index==0:
                for card in KNOWLEDGE_CARDS:
                    card_id = f"backend-demo-t{tenant_id}-{card['id']}"
                    await graph_service.upsert_business_node("KnowledgeCard", card_id, {"name": card["title"], "summary": card["scenario"], "status": card["status"], "risk": "low", "source_id": card["id"], "actions": (card.get("guidance") or card.get("steps") or [])[:3], "source_system": SEED_KEY, "tenant_id": tenant_id, "occurred_at": (scenario["moment"]+timedelta(minutes=12)).isoformat()})
                    node_count += 1
                    for linked in card.get("linked_objects", []):
                        for node in nodes:
                            if node["type"]==linked["type"] and node["name"] in [linked["id"],linked["name"]]:
                                await graph_service.upsert_business_edge(card_id, ids[node["id"]], "EVIDENCE_FOR", {"label": "知识证据", "source_system": SEED_KEY, "occurred_at": (scenario["moment"]+timedelta(minutes=12)).isoformat()})
                                edge_count += 1
    return {"nodes": node_count, "relationships": edge_count, "historical_versions": len(scenarios)*len(QUALITY_EVENT_DEMO["nodes"])*3}


async def main():
    logging.disable(logging.INFO)
    _engine.echo = False
    scenarios, source_id = await seed_relational()
    graph = await seed_graph(scenarios)
    from app.services.metadata_scan_service import scan_data_source_metadata
    async with AsyncSessionLocal() as db:
        metadata = await scan_data_source_metadata(db, tenant_id=1, source_id=source_id, limit_tables=8, sample_limit=3)
        await db.commit()
    print(json.dumps({"events": [f"QD-{row['defect']}" for row in scenarios], "sensor_readings": len(scenarios)*61,
                      "spc_points": len(scenarios)*61, "source_id": source_id,
                      "metadata_tables": len(metadata.get("tables", [])), "graph": graph}, ensure_ascii=False))
    await neo4j_driver.close()
    await _engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
