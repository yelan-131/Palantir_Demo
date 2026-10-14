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


def main() -> None:
    parser = argparse.ArgumentParser(description="Update ManuFoundry release metadata.")
    parser.add_argument("version", help="New semantic version, for example 0.3.1")
    parser.add_argument("--title", default="版本更新", help="Release title")
    parser.add_argument("--summary", default="", help="Short release summary")
    parser.add_argument("--released-at", default=date.today().isoformat(), help="Release date (YYYY-MM-DD)")
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
    date.fromisoformat(args.released_at)

    release = load_json(RELEASE_FILE) if RELEASE_FILE.exists() else {}
    records = [record for record in release.get("records", []) if record.get("version") != args.version]
    records.insert(0, {
        "version": args.version,
        "released_at": args.released_at,
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
            "released_at": args.released_at,
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
