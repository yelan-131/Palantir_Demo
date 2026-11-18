import pytest
from fastapi import HTTPException

from app.services.workflow_routing import route_node_ids, validate_graph
from app.services.workflow_views import _instance_steps, _workflow_config_steps


def graph(nodes, edges):
    return {
        "nodes": [{"id": key, "type": kind} for key, kind in nodes],
        "edges": [{"source": source, "target": target} for source, target in edges],
    }


@pytest.mark.parametrize(
    ("config", "detail"),
    [
        ({}, "至少一个开始事件"),
        (graph([("start", "startEvent"), ("review", "userTask")], [("start", "review")]), "至少一个结束事件"),
        (graph([("start", "startEvent"), ("end", "endEvent")], []), "开始事件必须连接"),
        ({"steps": [{"type": "approval"}, {"type": "end"}]}, "唯一的开始事件"),
        ({"steps": [{"type": "start"}, {"type": "approval"}]}, "最后一个步骤"),
    ],
)
def test_invalid_workflow_boundaries(config, detail):
    with pytest.raises(HTTPException) as error:
        validate_graph(config)
    assert error.value.status_code == 422
    assert detail in error.value.detail


def test_valid_visual_branches_and_linear_approvals():
    config = graph(
        [("start", "startEvent"), ("choice", "exclusiveGateway"), ("yes", "endEvent"), ("no", "endEvent")],
        [("start", "choice"), ("choice", "yes"), ("choice", "no")],
    )
    config["edges"][1]["isDefault"] = True
    config["edges"][2].update({"conditionField": "cancelled", "conditionValue": True})

    assert route_node_ids(config, {"cancelled": False}) == ["start", "choice", "yes"]
    assert route_node_ids(config, {"cancelled": True}) == ["start", "choice", "no"]
    validate_graph({"steps": [{"type": "start"}, {"type": "approval"}, {"type": "end"}]})


def test_multiple_start_events_select_the_trigger_path_and_pin_it_to_the_instance():
    config = graph(
        [("first", "startEvent"), ("second", "startEvent"), ("review", "userTask"), ("yes", "endEvent"), ("no", "endEvent")],
        [("first", "yes"), ("second", "review"), ("review", "no")],
    )
    config["triggerBindings"] = [
        {"action": "submit", "enabled": True, "startNodeId": "first"},
        {"action": "manual_submit", "enabled": True, "startNodeId": "second"},
    ]

    assert route_node_ids(config, {}) == ["first", "yes"]
    steps = _workflow_config_steps(config, {}, trigger_action="manual_submit")
    path = [step["node_id"] for step in steps]
    assert path == ["second", "review", "no"]
    assert _instance_steps(config, {"execution_node_ids": path}) == steps
    with pytest.raises(HTTPException) as error:
        route_node_ids(config, {}, trigger_action="unbound")
    assert error.value.status_code == 409

    config["triggerBindings"][0].pop("startNodeId")
    with pytest.raises(HTTPException, match="选择开始事件"):
        validate_graph(config)

    config["edges"].pop(1)
    with pytest.raises(HTTPException, match="每个开始事件"):
        validate_graph(config)
