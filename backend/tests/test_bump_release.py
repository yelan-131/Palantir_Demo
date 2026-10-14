import importlib.util
import json
from pathlib import Path


def test_release_bump_preserves_history_and_is_repeatable(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[2] / "scripts/bump_release.py"
    spec = importlib.util.spec_from_file_location("bump_release", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    paths = {}
    for name in ("RELEASE_FILE", "BACKEND_RELEASE_FILE", "BACKEND_CONFIG", "FRONTEND_PACKAGE", "FRONTEND_LOCK"):
        paths[name] = tmp_path / name
        monkeypatch.setattr(module, name, paths[name])
    paths["RELEASE_FILE"].write_text(json.dumps({"records": [{"version": "0.3.9", "title": "previous"}]}))
    paths["BACKEND_CONFIG"].write_text('APP_VERSION: str = "0.3.9"\n')
    paths["FRONTEND_PACKAGE"].write_text(json.dumps({"version": "0.3.9", "dependencies": {"react": "18"}}))
    paths["FRONTEND_LOCK"].write_text(json.dumps({"version": "0.3.9", "packages": {"": {"version": "0.3.9"}}}))
    monkeypatch.setattr("sys.argv", ["bump_release", "0.3.10", "--released-at", "2026-10-14", "--title", "new", "--added", "approval", "--improved", "navigation"])
    module.main()
    module.main()
    release = json.loads(paths["RELEASE_FILE"].read_text())
    assert release == json.loads(paths["BACKEND_RELEASE_FILE"].read_text())
    assert [record["version"] for record in release["records"]] == ["0.3.10", "0.3.9"]
    assert release["records"][0]["categories"] == {"added": ["approval"], "improved": ["navigation"], "removed": []}
    assert release["records"][0]["released_at"] == "2026-10-14"
    assert release["show_popup"] is True
    assert '"0.3.10"' in paths["BACKEND_CONFIG"].read_text()
    package = json.loads(paths["FRONTEND_PACKAGE"].read_text())
    assert package["version"] == "0.3.10"
    assert package["dependencies"] == {"react": "18"}
    assert json.loads(paths["FRONTEND_LOCK"].read_text())["packages"][""]["version"] == "0.3.10"
