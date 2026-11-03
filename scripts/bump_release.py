from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE_FILE = ROOT / "release.json"
BACKEND_RELEASE_FILE = ROOT / "backend" / "release.json"
BACKEND_CONFIG = ROOT / "backend" / "app" / "config.py"
FRONTEND_PACKAGE = ROOT / "frontend" / "package.json"
FRONTEND_LOCK = ROOT / "frontend" / "package-lock.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def version_tuple(value: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", value):
        raise ValueError("版本号必须为 X.Y.Z，不能带前导零或后缀")
    return tuple(map(int, value.split('.')))


def validate_transition(release: dict, target: str, kind: str, status: str) -> None:
    new = version_tuple(target)
    records = release.get('records') or []
    current = release.get('version') or (records[0].get('version') if records else None)
    if not current:
        return
    old = version_tuple(current)
    entry = next((row for row in records if row.get('version') == current), {})
    current_status = release.get('status', entry.get('status', 'published'))
    if current_status not in {'draft', 'published'}:
        raise ValueError('当前状态无效，请先核对清单')
    if target == current:
        if current_status != 'draft':
            raise ValueError('已发布版本不可覆盖；代码改动应创建下一版本')
        return
    if current_status == 'draft':
        raise ValueError('已有待发布版本，请继续维护；取消或拆分需单独处理')
    expected = {'patch': (old[0], old[1], old[2] + 1),
                'minor': (old[0], old[1] + 1, 0),
                'major': (old[0] + 1, 0, 0)}[kind]
    if new != expected:
        raise ValueError(f'{kind} 升版应为 {".".join(map(str, expected))}，不允许回退或跳号')
    if status != 'draft':
        raise ValueError('新版本必须先创建为 draft，完成验证后再标记 published')


def main() -> None:
    parser = argparse.ArgumentParser(description="Update ManuFoundry release metadata.")
    parser.add_argument("version", help="New semantic version, for example 0.3.1")
    parser.add_argument('--kind', choices=['patch', 'minor', 'major'], default='patch')
    parser.add_argument('--status', choices=['draft', 'published'], default='draft')
    parser.add_argument("--title", default="版本更新", help="Release title")
    parser.add_argument("--summary", default="", help="Short release summary")
    parser.add_argument("--released-at", default=None, help="Actual release date, required for published")
    parser.add_argument("--added", action="append", default=[], help="Added item in release history")
    parser.add_argument("--improved", action="append", default=[], help="Improved item in release history")
    parser.add_argument("--removed", action="append", default=[], help="Removed item in release history")
    parser.add_argument(
        "--highlight",
        action="append",
        default=[],
        help="Release highlight. Pass multiple times for multiple bullets.",
    )
    parser.add_argument(
        "--detail",
        action="append",
        default=[],
        help="Release detail. Pass multiple times for multiple bullets.",
    )
    parser.add_argument("--no-popup", action="store_true", help="Do not show update popup for this release")
    args = parser.parse_args()
    if args.released_at:
        date.fromisoformat(args.released_at)
    if args.status == 'published' and not args.released_at:
        parser.error('published 状态必须提供实际 --released-at 日期')

    release = load_json(RELEASE_FILE) if RELEASE_FILE.exists() else {}
    try:
        validate_transition(release, args.version, args.kind, args.status)
    except ValueError as exc:
        parser.error(str(exc))
    records = [record for record in release.get("records", []) if record.get("version") != args.version]
    records.insert(0, {
        "version": args.version,
        "released_at": args.released_at if args.status == 'published' else None,
        "status": args.status,
        "updated_at": date.today().isoformat(),
        "title": args.title,
        "categories": {
            "added": args.added or args.highlight,
            "improved": args.improved or args.detail,
            "removed": args.removed,
        },
    })
    release.update(
        {
            "version": args.version,
            "released_at": args.released_at if args.status == 'published' else None,
            "status": args.status,
            "updated_at": date.today().isoformat(),
            "title": args.title,
            "summary": args.summary,
            "highlights": args.highlight,
            "details": args.detail,
            "show_popup": not args.no_popup,
            "records": records,
        }
    )
    write_json(RELEASE_FILE, release)
    write_json(BACKEND_RELEASE_FILE, release)

    backend_config = BACKEND_CONFIG.read_text(encoding="utf-8")
    backend_config = re.sub(r'APP_VERSION: str = "[^"]+"', f'APP_VERSION: str = "{args.version}"', backend_config)
    BACKEND_CONFIG.write_text(backend_config, encoding="utf-8")

    package = load_json(FRONTEND_PACKAGE)
    package["version"] = args.version
    write_json(FRONTEND_PACKAGE, package)

    if FRONTEND_LOCK.exists():
        package_lock = load_json(FRONTEND_LOCK)
        package_lock["version"] = args.version
        package_lock.setdefault("packages", {}).setdefault("", {})["version"] = args.version
        write_json(FRONTEND_LOCK, package_lock)


if __name__ == "__main__":
    main()
