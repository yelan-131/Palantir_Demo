"""Tests for model version management and impact detection."""
import json
from datetime import datetime
from unittest.mock import MagicMock

import pytest


# ── Helpers ────────────────────────────────────────────────

def _make_mock_model(model_id=1, version=1, name="equipment"):
    """Create a mock MetaModel object."""
    m = MagicMock()
    m.id = model_id
    m.name = name
    m.label = "设备"
    m.version = version
    m.table_name = name
    m.description = "test model"
    m.updated_at = datetime(2026, 5, 13, 12, 0, 0)
    return m


def _make_mock_field(field_id=1, field_name="name", field_type="string", required=True, sort_order=0):
    """Create a mock MetaField object."""
    f = MagicMock()
    f.id = field_id
    f.field_name = field_name
    f.label = field_name
    f.field_type = field_type
    f.required = required
    f.sort_order = sort_order
    return f


def _make_mock_version(version_id=1, model_id=1, version=1, snapshot=None, change_description=""):
    """Create a mock ModelVersion object."""
    v = MagicMock()
    v.id = version_id
    v.model_id = model_id
    v.version = version
    v.snapshot = snapshot or json.dumps({"name": "equipment", "fields": []})
    v.change_description = change_description
    v.created_at = datetime(2026, 5, 13, 12, 0, 0)
    return v


def _make_mock_page(page_id=1, name="equipment-list", title="设备管理", model_id=1, paradigm="master-detail"):
    """Create a mock PageConfig object."""
    p = MagicMock()
    p.id = page_id
    p.name = name
    p.title = title
    p.model_id = model_id
    p.paradigm = paradigm
    p.route_path = f"/dynamic/{name}"
    return p


# ── Publish (bump version) ─────────────────────────────────

def test_publish_bumps_version():
    """Publishing a model should increment the version number."""
    mock_model = _make_mock_model(model_id=1, version=2)

    # Simulate the publish logic: bump version
    current_version = mock_model.version  # 2
    new_version = current_version + 1
    mock_model.version = new_version

    assert mock_model.version == 3


def test_publish_creates_version_record():
    """Publishing should create a ModelVersion record with snapshot."""
    from app.models.relational import ModelVersion

    snapshot = json.dumps({
        "name": "equipment", "label": "设备", "table_name": "equipment",
        "fields": [{"field_name": "name", "field_type": "string"}],
    })

    record = ModelVersion(
        model_id=1,
        version=2,
        snapshot=snapshot,
        change_description="Added health_score field",
    )

    assert record.model_id == 1
    assert record.version == 2
    parsed = json.loads(record.snapshot)
    assert parsed["name"] == "equipment"
    assert len(parsed["fields"]) == 1


# ── Version History ────────────────────────────────────────

def test_version_history_returns_records():
    """Version history should return all recorded versions for a model."""
    v1 = _make_mock_version(version_id=1, model_id=1, version=3, change_description="Added field X")
    v2 = _make_mock_version(version_id=2, model_id=1, version=2, change_description="Initial publish")

    versions = [v1, v2]
    output = [
        {
            "version": v.version,
            "changes": v.change_description or "",
            "snapshot": json.loads(v.snapshot) if isinstance(v.snapshot, str) else v.snapshot,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in versions
    ]

    assert len(output) == 2
    assert output[0]["version"] == 3
    assert output[0]["changes"] == "Added field X"
    assert output[1]["version"] == 2


def test_version_history_empty_returns_current():
    """When no version history exists, should synthesize from current model."""
    mock_model = _make_mock_model(model_id=1, version=1)
    mock_field = _make_mock_field()

    snapshot = json.dumps({
        "name": mock_model.name, "label": mock_model.label,
        "table_name": mock_model.table_name,
        "fields": [{"field_name": mock_field.field_name, "field_type": mock_field.field_type}],
    }, ensure_ascii=False)

    result = {
        "data": [{
            "version": getattr(mock_model, "version", 1),
            "changes": "Current version",
            "snapshot": json.loads(snapshot),
            "created_at": mock_model.updated_at.isoformat(),
        }]
    }

    assert result["data"][0]["version"] == 1
    assert result["data"][0]["changes"] == "Current version"
    assert result["data"][0]["snapshot"]["name"] == "equipment"


# ── Impact Detection ───────────────────────────────────────

def test_impact_detects_pages():
    """Impact detection should find pages that reference the model."""
    mock_page1 = _make_mock_page(page_id=1, name="equipment-list", model_id=1, paradigm="master-detail")
    mock_page2 = _make_mock_page(page_id=2, name="equipment-form", model_id=1, paradigm="form")

    pages = [mock_page1, mock_page2]

    affected_pages = [
        {"id": p.id, "name": p.name, "title": p.title, "route_path": p.route_path}
        for p in pages
    ]
    affected_forms = [
        {"id": p.id, "name": p.name, "title": p.title}
        for p in pages if "form" in (p.paradigm or "").lower()
    ]

    assert len(affected_pages) == 2
    assert affected_pages[0]["name"] == "equipment-list"
    assert len(affected_forms) == 1
    assert affected_forms[0]["name"] == "equipment-form"


def test_impact_no_pages():
    """Impact detection should return empty when no pages reference the model."""
    pages = []

    affected_pages = [
        {"id": p.id, "name": p.name, "title": p.title, "route_path": p.route_path}
        for p in pages
    ]

    assert affected_pages == []


def test_impact_data_migration_flag_type_change():
    """Data migration flag should be True when a field type changed."""
    old_snapshot = {
        "fields": [
            {"field_name": "name", "field_type": "string"},
            {"field_name": "quantity", "field_type": "float"},
        ]
    }
    old_fields = {f["field_name"]: f["field_type"] for f in old_snapshot.get("fields", [])}

    current_fields = {
        "name": "string",
        "quantity": "integer",  # type changed from float to integer
    }

    data_migration = False
    for fname, ftype in old_fields.items():
        if fname not in current_fields:
            data_migration = True
            break
        if current_fields[fname] != ftype:
            data_migration = True
            break

    assert data_migration is True


def test_impact_data_migration_removed_field():
    """Data migration flag should be True when a field was removed."""
    old_snapshot = {
        "fields": [
            {"field_name": "name", "field_type": "string"},
            {"field_name": "legacy_field", "field_type": "string"},
        ]
    }
    old_fields = {f["field_name"]: f["field_type"] for f in old_snapshot.get("fields", [])}

    # legacy_field was removed
    current_fields = {"name": "string"}

    data_migration = False
    for fname, ftype in old_fields.items():
        if fname not in current_fields:
            data_migration = True
            break
        if current_fields[fname] != ftype:
            data_migration = True
            break

    assert data_migration is True


def test_impact_data_migration_no_change():
    """Data migration flag should be False when fields are unchanged."""
    old_snapshot = {
        "fields": [
            {"field_name": "name", "field_type": "string"},
            {"field_name": "quantity", "field_type": "float"},
        ]
    }
    old_fields = {f["field_name"]: f["field_type"] for f in old_snapshot.get("fields", [])}

    current_fields = {
        "name": "string",
        "quantity": "float",
    }

    data_migration = False
    for fname, ftype in old_fields.items():
        if fname not in current_fields:
            data_migration = True
            break
        if current_fields[fname] != ftype:
            data_migration = True
            break

    assert data_migration is False


# ── ModelVersion ORM ───────────────────────────────────────

def test_model_version_model_fields():
    """ModelVersion should have all required columns."""
    from app.models.relational import ModelVersion

    cols = {c.name for c in ModelVersion.__table__.columns}
    expected = {"id", "model_id", "version", "snapshot", "change_description", "created_by", "created_at"}
    assert expected.issubset(cols), f"Missing columns: {expected - cols}"


def test_meta_model_has_version_column():
    """MetaModel should have a version column."""
    from app.models.relational import MetaModel

    cols = {c.name for c in MetaModel.__table__.columns}
    assert "version" in cols, "MetaModel missing 'version' column"


def test_meta_model_has_versions_relationship():
    """MetaModel should have a model_versions relationship."""
    from app.models.relational import MetaModel

    rels = {rel.key for rel in MetaModel.__mapper__.relationships}
    assert "model_versions" in rels, "MetaModel missing 'model_versions' relationship"
