import importlib.util
import json
import pytest
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
    assert release["records"][0]["released_at"] is None
    assert release['status'] == 'draft'
    assert release["show_popup"] is True
    assert '"0.3.10"' in paths["BACKEND_CONFIG"].read_text()
    package = json.loads(paths["FRONTEND_PACKAGE"].read_text())
    assert package["version"] == "0.3.10"
    assert package["dependencies"] == {"react": "18"}
    assert json.loads(paths["FRONTEND_LOCK"].read_text())["packages"][""]["version"] == "0.3.10"
    monkeypatch.setattr('sys.argv', ['bump_release', '0.3.10', '--status', 'published', '--released-at', '2026-10-14'])
    module.main()
    published = paths['RELEASE_FILE'].read_text()
    assert json.loads(published)['status'] == 'published'
    with pytest.raises(SystemExit):
        module.main()
    assert paths['RELEASE_FILE'].read_text() == published


@pytest.mark.parametrize('target,kind,status,blocked', [
    ('0.3.19', 'patch', 'draft', False),
    ('0.4.0', 'minor', 'draft', False),
    ('1.0.0', 'major', 'draft', False),
    ('0.3.18', 'patch', 'draft', True),
    ('0.3.17', 'patch', 'draft', True),
    ('0.3.20', 'patch', 'draft', True),
    ('0.4.0', 'patch', 'draft', True),
    ('0.3.19', 'patch', 'published', True),
    ('0.03.19', 'patch', 'draft', True),
    ('0.3.19-rc1', 'patch', 'draft', True),
])
def test_release_transition_rules(target, kind, status, blocked):
    source = Path(__file__).resolve().parents[2] / 'scripts/bump_release.py'
    spec = importlib.util.spec_from_file_location('release_rules', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Old manifests without status are treated as frozen releases.
    release = {'version': '0.3.18'}
    if blocked:
        with pytest.raises(ValueError):
            module.validate_transition(release, target, kind, status)
    else:
        module.validate_transition(release, target, kind, status)


def test_draft_cannot_be_skipped():
    source = Path(__file__).resolve().parents[2] / 'scripts/bump_release.py'
    spec = importlib.util.spec_from_file_location('draft_rules', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with pytest.raises(ValueError):
        module.validate_transition({'version': '0.3.19', 'status': 'draft'}, '0.3.20', 'patch', 'draft')
