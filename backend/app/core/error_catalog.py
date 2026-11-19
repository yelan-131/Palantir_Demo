"""Shared error catalog and offline operator lookup."""

import argparse
import json
from pathlib import Path


REQUEST_ID = "X-Request-ID"
ERROR_CODE = "X-Error-Code"
CATALOG: dict[str, list[str]] = json.loads(
    Path(__file__).with_suffix(".json").read_text(encoding="utf-8")
)


def http_error_code(status: int) -> str:
    code = f"HTTP_{status}"
    return code if code in CATALOG else f"HTTP_{status // 100}XX"


def main() -> None:
    parser = argparse.ArgumentParser(description="查询 ManuFoundry 错误码和排查步骤")
    parser.add_argument("code", nargs="?", help="错误码或 HTTP 状态码。省略时列出全部错误码")
    args = parser.parse_args()
    if args.code is None:
        for code, (title, _) in CATALOG.items():
            print(f"{code}  {title}")
        return
    code = args.code.strip().upper()
    status_text = code.removeprefix("HTTP_")
    if len(status_text) == 3 and status_text.isascii() and status_text.isdecimal():
        status = int(status_text)
        if 400 <= status <= 599:
            code = http_error_code(status)
    if code not in CATALOG:
        parser.error(f"未知错误码 {args.code}")
    title, action = CATALOG[code]
    print(f"{code}  {title}\n{action}")


if __name__ == "__main__":
    main()
