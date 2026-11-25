import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/v1/graph/query"),
        ("GET", "/api/v1/graph/neighbors/1"),
        ("GET", "/api/v1/graph/path?src_id=1&tgt_id=2"),
        ("GET", "/api/v1/graph/subgraph/1"),
    ],
)
def test_retired_graph_endpoints_return_404(method, path):
    response = TestClient(app).request(method, path)
    assert response.status_code == 404
