"""Conservative classification protects actual material-related alerts."""
import copy
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "alert_migration", Path(__file__).parents[1] / "scripts" / "migrate_alert_material_requests.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def test_explicit_material_requests_only():
    for title in ["新增料号申请：MAT-20260616-1336", "前端新增料号申请：MAT-UI-20260616-1421"]:
        assert migration.is_material_request({"title": title})
    for title in ["测试料号", "现场验证料号-减速机端盖申请", "物料库存不足", "料号异常告警", "新增料号申请：", "监测：新增料号申请：MAT-1", None]:
        assert not migration.is_material_request({"title": title})


def test_snapshot_and_approval_identity_preserved():
    source = {"id": 369, "tenant_id": 1, "title": "前端新增料号申请：MAT-UI-20260616-1421",
              "status": "处理中", "process_status": None, "source_dynamic_record_id": 999,
              "interaction_log": "admin 从前端申请料号", "evidence": {"files": ["historical.pdf"]}}
    original = copy.deepcopy(source)
    result = migration.request_payload(source, 1, "physical_table", "business_alert_center")
    assert source == original
    assert result["source_payload"] == original
    assert result["source_record_id"] == 369
    assert result["approval_source"]["form_id"] == 1
    assert result["approval_source"]["source_dynamic_record_id"] == 999
    assert result["approval_source"]["route"] == "/workflow?tab=all&source_form_id=1&source_record_id=369"
    assert result["part_no"] == "MAT-UI-20260616-1421"
    result["source_payload"]["evidence"]["files"].append("new.pdf")
    assert source == original


def test_display_status_does_not_rewrite_historical_state():
    for old, expected in [("已关闭", "已完成"), ("已驳回", "已驳回"), (None, "待处理")]:
        result = migration.request_payload({"id": 368, "title": "新增料号申请：MAT-1", "status": old}, 1, "physical_table", "business_alert_center")
        assert result["status"] == expected
        assert result["source_payload"]["status"] == old
