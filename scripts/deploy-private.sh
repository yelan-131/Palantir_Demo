#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker/docker-compose.release.yml}"
OFFLINE_PACKAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --compose) COMPOSE_FILE="$2"; shift 2 ;;
    --offline) OFFLINE_PACKAGE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$ROOT"
test -f "$ENV_FILE" || { echo "Missing env file: $ENV_FILE" >&2; exit 1; }
test -f "$COMPOSE_FILE" || { echo "Missing compose file: $COMPOSE_FILE" >&2; exit 1; }

if [[ -n "$OFFLINE_PACKAGE" ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  unzip -q "$OFFLINE_PACKAGE" -d "$tmp"
  find "$tmp" -name "*.tar" -print0 | while IFS= read -r -d '' tarfile; do
    docker load -i "$tarfile"
  done
else
  get_env() {
    grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
  }
  ghcr_username="$(get_env GHCR_USERNAME || true)"
  ghcr_token="$(get_env GHCR_TOKEN || true)"
  if [[ -n "$ghcr_username" && -n "$ghcr_token" ]]; then
    echo "$ghcr_token" | docker login ghcr.io -u "$ghcr_username" --password-stdin
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull backend frontend
fi

python "$ROOT/scripts/doctor.py" --env "$ENV_FILE" --compose "$COMPOSE_FILE" --skip-runtime
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres neo4j
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d backend frontend
docker exec manufoundry-backend alembic upgrade head
python "$ROOT/scripts/doctor.py" --env "$ENV_FILE" --compose "$COMPOSE_FILE" --wait 60
