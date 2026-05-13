"""Tests for audit logging and seed config."""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_convert_datetimes_equipment():
    from app.core.seed_config import convert_datetimes

    rows = [
        {"id": 1, "name": "CNC-001", "install_date": "2024-03-10"},
        {"id": 2, "name": "CNC-002", "install_date": None},
    ]
    result = convert_datetimes("equipment", rows)
    assert isinstance(result[0]["install_date"], datetime)
    assert result[0]["install_date"] == datetime(2024, 3, 10)
    assert result[1]["install_date"] is None


@pytest.mark.asyncio
async def test_convert_datetimes_iso_timestamp():
    from app.core.seed_config import convert_datetimes

    rows = [{"id": 1, "timestamp": "2026-04-20T21:00:00"}]
    result = convert_datetimes("sensor_readings", rows)
    assert isinstance(result[0]["timestamp"], datetime)
    assert result[0]["timestamp"].year == 2026


@pytest.mark.asyncio
async def test_convert_datetimes_no_match():
    from app.core.seed_config import convert_datetimes

    rows = [{"id": 1, "name": "test"}]
    result = convert_datetimes("factories", rows)
    assert result == rows


def test_make_insert_sql():
    from app.core.seed_config import make_insert_sql

    sql = make_insert_sql("factories")
    assert sql == "INSERT INTO factories (id, name, location, capacity, status, description) VALUES (:id, :name, :location, :capacity, :status, :description)"

    sql_ignore = make_insert_sql("factories", conflict="OR IGNORE")
    assert sql_ignore.startswith("INSERT OR IGNORE INTO factories")


def test_seed_table_columns_complete():
    from app.core.seed_config import SEED_TABLE_COLUMNS

    assert "factories" in SEED_TABLE_COLUMNS
    assert "sensor_readings" in SEED_TABLE_COLUMNS
    assert "id" in SEED_TABLE_COLUMNS["factories"]


@pytest.mark.asyncio
async def test_write_audit_log_best_effort():
    """write_audit_log should not raise on DB failure."""
    with patch("app.core.db.db_session") as mock_session:
        mock_session.side_effect = Exception("DB down")
        from app.core.audit import write_audit_log
        # Should not raise
        await write_audit_log(
            action="create",
            resource_type="equipment",
            resource_id=1,
            new_values={"name": "test"},
        )


@pytest.mark.asyncio
async def test_write_audit_log_success():
    """write_audit_log should write correct fields."""
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    mock_session.add = MagicMock()
    mock_session.commit = AsyncMock()

    with patch("app.core.db.db_session", return_value=mock_session):
        from app.core.audit import write_audit_log
        await write_audit_log(
            action="update",
            resource_type="equipment",
            resource_id=42,
            old_values={"name": "old"},
            new_values={"name": "new"},
            user_id=1,
        )
        mock_session.add.assert_called_once()
        entry = mock_session.add.call_args[0][0]
        assert entry.action == "update"
        assert entry.resource_type == "equipment"
        assert entry.resource_id == 42
        assert entry.user_id == 1
        assert json.loads(entry.old_values) == {"name": "old"}
        assert json.loads(entry.new_values) == {"name": "new"}
