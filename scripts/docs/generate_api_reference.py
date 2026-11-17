"""Regenerate the route tables in docs/development/api-reference.md.

Routes are read statically from backend/app/main.py and backend/app/api/*.py,
so backend dependencies do not need to be installed.

    python scripts/docs/generate_api_reference.py          # rewrite the doc
    python scripts/docs/generate_api_reference.py --check  # exit 1 if stale
"""
from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API_DIR = ROOT / "backend" / "app" / "api"
MAIN = ROOT / "backend" / "app" / "main.py"
AUTH_TEST = ROOT / "backend" / "tests" / "test_route_auth_coverage.py"
DOC = ROOT / "docs" / "development" / "api-reference.md"
START, END = "<!-- api-routes:start -->", "<!-- api-routes:end -->"
METHODS = ("get", "post", "put", "patch", "delete")
METHOD_ORDER = {name.upper(): index for index, name in enumerate(METHODS)}
LABELS = {
    "": "登录",
    "admin": "管理员",
    "platform_admin": "平台管理员",
    "form": "表单权限",
    "rbac": "RBAC",
    "platform_admin_writes": "读：登录；写：平台管理员",
}
SYSTEM_ROUTES = [
    ("/", "GET", "main", "root", ""),
    ("/health", "GET", "main", "health", ""),
    ("/api/v1/system/readiness", "GET", "main", "readiness", ""),
    ("/api/v1/system/metrics", "GET", "main", "metrics", "admin"),
]


def _access_level(source: str) -> str:
    if "require_platform_admin_for_writes" in source:
        return "platform_admin_writes"
    if "require_platform_admin" in source:
        return "platform_admin"
    if "require_admin" in source:
        return "admin"
    if "require_form_permission" in source:
        return "form"
    if "require_permission" in source:
        return "rbac"
    return ""


def _mount_prefixes() -> dict[str, list[str]]:
    text = MAIN.read_text(encoding="utf-8")
    aliases = dict(re.findall(r"from app\.api\.(\w+) import router as (\w+)", text))
    prefixes: dict[str, list[str]] = {}
    for target, prefix in re.findall(r'include_router\(([\w\.]+),\s*prefix="([^"]+)"', text):
        if target in aliases.values():
            target = next(f"{module}.router" for module, alias in aliases.items() if alias == target)
        prefixes.setdefault(target, []).append(prefix)
    # model_driven.py aggregates sibling routers and guards writes for all of them.
    for module, router in re.findall(r"router\.include_router\((\w+)\.(\w+)\)", (API_DIR / "model_driven.py").read_text(encoding="utf-8")):
        prefixes[f"{module}.{router}"] = prefixes.get("model_driven.router", [])
    return prefixes


def _routes() -> list[tuple[str, str, str, str, str]]:
    prefixes = _mount_prefixes()
    rows = []
    for path in sorted(API_DIR.glob("*.py")):
        module = path.stem
        tree = ast.parse(path.read_text(encoding="utf-8"))
        routers: dict[str, tuple[str, str]] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and getattr(node.value.func, "id", "") == "APIRouter":
                keywords = {kw.arg: kw.value for kw in node.value.keywords}
                prefix = keywords["prefix"].value if "prefix" in keywords else ""
                level = _access_level(ast.unparse(keywords["dependencies"])) if "dependencies" in keywords else ""
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        routers[target.id] = (prefix, level)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                func = getattr(decorator, "func", None)
                if not (isinstance(func, ast.Attribute) and func.attr in METHODS and isinstance(func.value, ast.Name)):
                    continue
                router_prefix, router_level = routers.get(func.value.id, ("", ""))
                level = _access_level(ast.unparse(node.args)) or _access_level(ast.unparse(decorator)) or router_level
                if module.startswith("model_driven_"):
                    level = level or "platform_admin_writes"
                for mount in prefixes.get(f"{module}.{func.value.id}", []):
                    rows.append((mount + router_prefix + decorator.args[0].value, func.attr.upper(), module, node.name, level))
    return rows + SYSTEM_ROUTES


def _public_routes() -> set[tuple[str, str]]:
    tree = ast.parse(AUTH_TEST.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(target, "id", "") == "PUBLIC_ROUTES" for target in node.targets):
            return set(ast.literal_eval(node.value))
    raise SystemExit("PUBLIC_ROUTES not found in " + str(AUTH_TEST))


def render() -> str:
    public = _public_routes()
    groups: dict[str, list] = {}
    rows = _routes()
    for row in rows:
        path = row[0]
        group = path.split("/")[3] if path.startswith("/api/v1/") else ""
        groups.setdefault(group, []).append(row)
    lines = [f"共 {len(rows)} 个接口。", ""]
    for group in sorted(groups):
        items = sorted(groups[group], key=lambda row: (row[0], METHOD_ORDER[row[1]]))
        lines += [f"### {f'`{group}`' if group else '根路径'}（{len(items)}）", "", "| 方法 | 路径 | 访问要求 | 处理函数 |", "| --- | --- | --- | --- |"]
        for path, method, module, function, level in items:
            access = "公开" if (method, path) in public else LABELS[level]
            shown = path.removeprefix("/api/v1")
            lines.append(f"| `{method}` | `{shown}` | {access} | `{module}.{function}` |")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="only report whether the doc is up to date")
    args = parser.parse_args()
    doc = DOC.read_text(encoding="utf-8")
    if START not in doc or END not in doc:
        print(f"Markers {START} / {END} missing in {DOC}", file=sys.stderr)
        return 2
    head, rest = doc.split(START, 1)
    _, tail = rest.split(END, 1)
    updated = f"{head}{START}\n{render()}{END}{tail}"
    if args.check:
        if updated != doc:
            print(f"{DOC.relative_to(ROOT)} is stale; run scripts/docs/generate_api_reference.py", file=sys.stderr)
            return 1
        return 0
    DOC.write_text(updated, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
