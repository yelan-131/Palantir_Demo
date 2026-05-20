# Deployment

Last updated: 2026-05-20

This document reflects the current repository files and the project deployment convention.

## Production Server

| Item | Value |
| --- | --- |
| SSH target | `root@111.229.172.100` |
| Server project path | `/root/Palantir_Demo` |
| Frontend public port | `80` |
| Frontend container port | `80` |
| Backend port | `8000` |
| Backend health endpoint | `http://111.229.172.100:8000/health` |

## Compose Files

Use these files together for production-style deployment:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build
```

Do not use `docker/docker-compose.prod-full.yml`; that file is not present in the current repository.

## Service Layout

| Service | Image/build | Host port | Container port | Notes |
| --- | --- | --- | --- | --- |
| `frontend` | `frontend/Dockerfile` | `80` | `80` | nginx static frontend and `/api/` reverse proxy |
| `backend` | `backend/Dockerfile` | `8000` | `8000` | FastAPI |
| `postgres` | `postgres:16-alpine` | `5432` in development compose | `5432` | relational database |
| `neo4j` | `neo4j:5-community` | `7474`, `7687` in development compose | `7474`, `7687` | graph database |
| `redis` | `redis:7-alpine` | `6379` in development compose | `6379` | cache |

The production overlay switches backend/frontend Dockerfiles, removes source mounts, runs backend without reload, and maps the frontend to `80:80`.

## Update Server Flow

When the user asks to update or sync the server, use this flow:

1. Commit and push local changes to GitHub.
2. SSH to the server as `root@111.229.172.100` using the configured private key.
3. Update `/root/Palantir_Demo` from GitHub.
4. Preserve unrelated server-local deployment files unless the user explicitly asks to overwrite them.
5. Rebuild and restart affected Docker Compose services.
6. Verify the public frontend and backend health endpoint.

## Commands

SSH:

```bash
ssh -i "claudecode.pem" root@111.229.172.100
```

Update repository:

```bash
cd /root/Palantir_Demo
git pull
```

Rebuild and restart:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build
```

Run migrations:

```bash
docker exec manufoundry-backend alembic upgrade head
```

Seed data when needed:

```bash
docker exec -w /app manufoundry-backend bash -c 'PYTHONPATH=/app python scripts/seed_data.py'
```

Check service status:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml ps
```

Check logs:

```bash
docker logs -f manufoundry-backend --tail 100
docker logs -f manufoundry-frontend --tail 100
```

## Verification

Frontend:

```bash
curl -I http://111.229.172.100
```

Backend:

```bash
curl -fsS http://111.229.172.100:8000/health
```

Expected backend response:

```json
{"status":"healthy"}
```

Swagger:

```text
http://111.229.172.100:8000/docs
```

## Rollback

If the new deployment fails:

```bash
cd /root/Palantir_Demo
git log --oneline -5
git checkout <previous-good-commit>
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build
curl -fsS http://111.229.172.100:8000/health
```

Return to the normal branch after the incident is resolved.

## Known Deployment Notes

- `frontend/nginx.conf` is the active nginx config.
- `/api/` is proxied from frontend nginx to `http://backend:8000/api/`.
- The backend has `GET /health` outside `/api/v1`.
- Production should set `DEMO_AUTH_OPTIONAL=false` and a real `SECRET_KEY`.
- The default CORS origins are local development origins; production should use explicit production origins.
