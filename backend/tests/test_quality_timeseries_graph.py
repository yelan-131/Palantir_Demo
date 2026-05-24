"""Quality impact graph should expose time-series evidence links."""


def test_quality_demo_contains_timeseries_evidence_nodes_and_edges():
    from app.api.quality import QUALITY_EVENT_DEMO

    node_by_id = {node["id"]: node for node in QUALITY_EVENT_DEMO["nodes"]}
    edge_by_id = {edge["id"]: edge for edge in QUALITY_EVENT_DEMO["edges"]}

    assert node_by_id["sensor-reflow-temp-05"]["type"] == "Sensor"
    assert node_by_id["ts-window-reflow-temp-260521-0930"]["type"] == "TimeSeriesWindow"
    assert edge_by_id["r17"]["relation_type"] == "MEASURED_BY"
    assert edge_by_id["r18"]["relation_type"] == "HAS_TS_ANOMALY"
    assert edge_by_id["r19"]["relation_type"] == "CORRELATES_WITH"
    assert edge_by_id["r20"]["target"] == "defect-001"


def test_graph_sync_maps_timeseries_relationships():
    from app.api.graph import QUALITY_BUSINESS_ID_MAP, QUALITY_EDGE_REL_MAP

    assert QUALITY_BUSINESS_ID_MAP["sensor-reflow-temp-05"] == "sensor-reflow-temp-05"
    assert QUALITY_EDGE_REL_MAP["r18"][0] == "HAS_TS_ANOMALY"
    assert QUALITY_EDGE_REL_MAP["r20"] == (
        "CORRELATES_WITH",
        "ts-window-reflow-temp-260521-0930",
        "defect-001",
    )
