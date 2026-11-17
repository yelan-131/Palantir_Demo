from types import SimpleNamespace
import pytest
from sqlalchemy import Column, Integer, JSON, MetaData, String, Table, create_engine, select, text
from app.services.form_engine.query import _record_matches_filters, _apply_record_filters_query
from app.services.form_engine.physical import _physical_filter_clause


@pytest.mark.parametrize("field_type,ui", [
    ("datetime", {}), ("timestamp", {}), ("date", {}),
    ("string", {"controlType": "datetime", "typeSettings": {"dateMode": "range"}}),
])
@pytest.mark.parametrize("end,expected_ids", [
    ("2026-11-09", [1, 2, 3]),
    ("2026-11-09T10:30:00", [1, 2]),
])
def test_date_range_has_identical_boundaries_in_memory_json_and_physical(field_type, ui, end, expected_ids):
    field = SimpleNamespace(field_name="occurred", field_type=field_type, ui_config=ui, archived=False, searchable=True)
    filters = [{"field": "occurred", "op": "between", "value": ["2026-11-01", end]}]
    values = ["2026-11-01", "2026-11-09T10:30:00", "2026-11-09T23:59:59.999999", "2026-11-10T00:00:00", "2026-10-31T23:59:59"]
    rows = [{"id": index + 1, "occurred": value, "data": {"occurred": value}} for index, value in enumerate(values)]
    memory_ids = [row["id"] for row in rows if _record_matches_filters(SimpleNamespace(data=row["data"]), [field], filters)]
    assert memory_ids == expected_ids
    engine = create_engine("sqlite://")
    table = Table("events", MetaData(), Column("id", Integer, primary_key=True), Column("occurred", String), Column("data", JSON))
    table.metadata.create_all(engine)
    try:
        with engine.begin() as connection:
            connection.execute(table.insert(), rows)
            query, pushed = _apply_record_filters_query(select(table.c.id).order_by(table.c.id), table.c, [field], filters)
            assert pushed
            assert list(connection.scalars(query)) == expected_ids
            clauses, params = _physical_filter_clause([field], {"occurred"}, filters)
            assert list(connection.scalars(text("SELECT id FROM events WHERE " + " AND ".join(clauses) + " ORDER BY id"), params)) == expected_ids
    finally:
        engine.dispose()


def test_non_date_range_keeps_its_original_upper_bound():
    field = SimpleNamespace(field_name="name", field_type="string", ui_config={}, archived=False)
    assert not _record_matches_filters(SimpleNamespace(data={"name": "2026-11-09-extra"}), [field],
        [{"field": "name", "op": "between", "value": ["2026-11-01", "2026-11-09"]}])
