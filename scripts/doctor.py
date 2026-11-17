from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV = ROOT / ".env"
DEFAULT_COMPOSE = ROOT / "docker" / "docker-compose.release.yml"

REQUIRED_ENV = [
    "IMAGE_NAMESPACE",
    "IMAGE_TAG",
    "APP_PUBLIC_URL",
    "CORS_ORIGINS",
    "SECRET_KEY",
    "POSTGRES_PASSWORD",
    "NEO4J_PASSWORD",
]

DEFAULT_PORTS = {
    "FRONTEND_PORT": 80,
    "BACKEND_PORT": 8000,
    "POSTGRES_PORT": 5432,
    "NEO4J_HTTP_PORT": 7474,
    "NEO4J_BOLT_PORT": 7687,
}


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def run(cmd: list[str], *, cwd: Path = ROOT, timeout: int = 30) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            cmd,
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
        )
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)
    return completed.returncode == 0, completed.stdout.strip()


def can_connect(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def http_ok(url: str, timeout: int = 10) -> tuple[bool, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read(300).decode("utf-8", errors="replace")
            return 200 <= response.status < 400, f"{response.status} {body}"
    except urllib.error.HTTPError as exc:
        body = exc.read(300).decode("utf-8", errors="replace")
        return False, f"{exc.code} {body}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def report(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" - {detail}" if detail else ""))
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description="ManuFoundry private deployment diagnostics.")
    parser.add_argument("--env", default=str(DEFAULT_ENV), help="Path to deployment .env file")
    parser.add_argument("--compose", default=str(DEFAULT_COMPOSE), help="Path to release compose file")
    parser.add_argument("--wait", type=int, default=0, help="Seconds to wait for health endpoints")
    parser.add_argument("--skip-runtime", action="store_true", help="Skip HTTP and container runtime checks")
    args = parser.parse_args()

    env_path = Path(args.env).resolve()
    compose_path = Path(args.compose).resolve()
    env = {**os.environ, **load_env(env_path)}
    failed = False

    failed |= not report("env file exists", env_path.exists(), str(env_path))
    failed |= not report("compose file exists", compose_path.exists(), str(compose_path))

    for key in REQUIRED_ENV:
        value = env.get(key, "")
        if key == "SECRET_KEY":
            ok = len(value) >= 32 and "change-me" not in value and "replace" not in value
        else:
            ok = bool(value) and "replace-" not in value
        failed |= not report(f"env {key}", ok)

    for command in (["docker", "--version"], ["docker", "compose", "version"]):
        ok, output = run(command)
        failed |= not report(" ".join(command), ok, output)

    ok, output = run(["docker", "compose", "--env-file", str(env_path), "-f", str(compose_path), "config"], timeout=45)
    failed |= not report("docker compose config", ok, output[-300:] if output else "")

    for key, default in DEFAULT_PORTS.items():
        try:
            port = int(env.get(key, default))
        except ValueError:
            failed |= not report(f"port {key}", False, f"invalid value {env.get(key)}")
            continue
        in_use = can_connect("127.0.0.1", port)
        report(f"port {key}={port}", True, "listening" if in_use else "not listening yet")

    if not args.skip_runtime:
        deadline = time.time() + max(args.wait, 0)
        backend_url = f"http://127.0.0.1:{env.get('BACKEND_PORT', '8000')}/health"
        frontend_url = f"http://127.0.0.1:{env.get('FRONTEND_PORT', '80')}/api/v1/release/current"
        while True:
            backend_ok, backend_detail = http_ok(backend_url)
            frontend_ok, frontend_detail = http_ok(frontend_url)
            if backend_ok and frontend_ok:
                break
            if time.time() >= deadline:
                break
            time.sleep(3)

        failed |= not report("backend health", backend_ok, backend_detail)
        failed |= not report("frontend api proxy", frontend_ok, frontend_detail)

        ok, output = run(["docker", "exec", "manufoundry-backend", "alembic", "current"], timeout=30)
        report("alembic current", ok, output[-300:] if output else "")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
