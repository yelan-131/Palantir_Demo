# Deployment

Last updated: 2026-05-29

This document reflects the current repository files and the project deployment convention.

## Local Development Startup

Use separate terminals for backend and frontend when working without Docker.

Backend:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd frontend
npm run dev -- --host 127.0.0.1 --port 3000
```

If the local sandbox blocks Vite dependency pre-bundling, serve the existing
production build with the lightweight local proxy:

```powershell
cd frontend
node local-static-server.mjs
```

Local verification:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/api/v1/system/readiness
Invoke-RestMethod http://127.0.0.1:8000/api/v1/release/current
Invoke-RestMethod http://127.0.0.1:8000/api/v1/productization/readiness
Invoke-WebRequest http://127.0.0.1:3000
```

The frontend reads `frontend/.env.local`; the current local proxy target is
`http://127.0.0.1:8000`.

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
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build
```

Do not use `docker/docker-compose.prod-full.yml`; that file is not present in the current repository.

## Runtime Modes

Demo/local mode:

```env
APP_MODE=demo
DEMO_AUTH_OPTIONAL=true
```

Demo mode may use mock fallbacks, seeded demo data, and SQLite fallback for local bootstrap.

Production mode:

```env
APP_MODE=production
DEMO_AUTH_OPTIONAL=false
SECRET_KEY=<strong-random-secret-at-least-32-chars>
AI_PROVIDER=glm
AI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

Production mode is fail-fast:

- unsafe/default `SECRET_KEY` stops startup
- `DEMO_AUTH_OPTIONAL=true` stops startup
- missing PostgreSQL/`asyncpg` or SQLite fallback stops startup
- core low-code APIs must return explicit errors instead of silently switching to demo data

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
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d --build
```

Run migrations:

```bash
docker exec manufoundry-backend alembic upgrade head
```

Current migration head includes SaaS hardening and application assembly work up
through `0024_seed_application_assembly.py`. Run migrations before verifying
tenant management, form publishing, Knowledge Center chat, and application
menus.

Seed data when needed:

```bash
docker exec -w /app manufoundry-backend bash -c 'PYTHONPATH=/app python scripts/seed_data.py'
```

Reload the large manufacturing demo dataset after replacing server data:

```bash
docker exec -w /app manufoundry-backend bash -c 'PYTHONPATH=/app python scripts/reseed_business_data.py'
```

Check service status:

```bash
docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml ps
```

Check logs:

```bash
docker logs -f manufoundry-backend --tail 100
docker logs -f manufoundry-frontend --tail 100
```

Pre-deploy verification from a clean working tree should include:

```bash
cd backend
python -m pytest

cd ../frontend
npm run type-check
npm run build
```

At minimum, run the ready-path guard before promoting a productization change:

```bash
cd backend
python -m pytest tests/test_ready_path_smoke.py tests/test_productization_boundaries.py
```

## Verification

Frontend:

```bash
curl -I http://111.229.172.100
```

Backend:

```bash
curl -fsS http://111.229.172.100:8000/health
curl -fsS http://111.229.172.100:8000/api/v1/system/readiness
curl -fsS http://111.229.172.100:8000/api/v1/release/current
curl -fsS http://111.229.172.100:8000/api/v1/productization/readiness
curl -fsS "http://111.229.172.100:8000/api/v1/dashboard/programs/line-status?limit=5"
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
