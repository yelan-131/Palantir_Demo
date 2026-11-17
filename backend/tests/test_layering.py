"""Import boundaries: route modules may depend on services, not the reverse."""
from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def _api_imports(path: Path) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            if node.module == "app.api":
                found.update(f"app.api.{alias.name}" for alias in node.names)
            elif node.module.startswith("app.api."):
                found.add(node.module)
        elif isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names if alias.name.startswith("app.api"))
    return found


def test_lower_layers_do_not_import_routes():
    offenders = {
        path.relative_to(APP.parent).as_posix(): sorted(found)
        for package in ("core", "models", "services")
        for path in sorted((APP / package).rglob("*.py"))
        if (found := _api_imports(path))
    }
    assert offenders == {}
