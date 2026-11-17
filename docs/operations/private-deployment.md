# Private Deployment

Last updated: 2026-05-29

This guide describes the customer/private deployment path. It is separate from
the development compose files and uses prebuilt images.

## Deployment Modes

Supported first-version modes:

- Online: pull images from GHCR.
- Offline: load image tar files from a release zip.
- Linux: bash scripts.
- Windows Server / Docker Desktop: PowerShell scripts.

The deployment target is a single Docker Compose host. Kubernetes and clustered
high availability are out of scope for this version.

## Required Files

Private deployment uses:

- `docker/docker-compose.release.yml`
- `.env.private.example`
- `scripts/deploy-private.sh`
- `scripts/deploy-private.ps1`
- `scripts/rollback-private.sh`
- `scripts/rollback-private.ps1`
- `scripts/doctor.py`

Copy `.env.private.example` to `.env` on the deployment host and replace every
placeholder before starting services.

Required environment variables:

| Variable | Purpose |
| --- | --- |
| `IMAGE_REGISTRY` | Defaults to `ghcr.io`. |
| `IMAGE_NAMESPACE` | GitHub/GHCR namespace, for example `yelan-131`. |
| `IMAGE_TAG` | Release image tag, for example `0.3.4-a1b2c3d`. |
| `APP_PUBLIC_URL` | Public frontend URL. |
| `CORS_ORIGINS` | Explicit frontend origins. |
| `SECRET_KEY` | Strong production secret, at least 32 characters. |
| `POSTGRES_PASSWORD` | PostgreSQL password. |
| `NEO4J_PASSWORD` | Neo4j password. |
| `GHCR_USERNAME` / `GHCR_TOKEN` | Optional for private GHCR image pulls. |

## Online Deployment

Linux:

```bash
cp .env.private.example .env
vim .env
./scripts/deploy-private.sh
```

Windows PowerShell:

```powershell
Copy-Item .env.private.example .env
notepad .env
.\scripts\deploy-private.ps1
```

The deployment script:

1. Validates Docker, Compose, `.env`, and compose config.
2. Logs in to GHCR when `GHCR_USERNAME` and `GHCR_TOKEN` are set.
3. Pulls backend and frontend images for `IMAGE_TAG`.
4. Starts PostgreSQL, Neo4j, backend, and frontend.
5. Runs `alembic upgrade head` inside `manufoundry-backend`.
6. Runs post-deploy health checks.

## Offline Deployment

Download the GitHub Actions artifact named `palantir-demo-release-<tag>`.
It contains:

- `palantir-demo-offline-<tag>.zip`
- `release-manifest.json`

Linux:

```bash
./scripts/deploy-private.sh --offline ./palantir-demo-offline-0.3.4-a1b2c3d.zip
```

Windows PowerShell:

```powershell
.\scripts\deploy-private.ps1 -Offline .\palantir-demo-offline-0.3.4-a1b2c3d.zip
```

Offline deployment loads the image tar files with `docker load`, then starts the
same release compose stack. It does not require GHCR access during installation.

## Diagnostics

Run doctor before or after deployment:

```bash
python scripts/doctor.py --env .env --compose docker/docker-compose.release.yml
```

For preflight checks without HTTP/container runtime validation:

```bash
python scripts/doctor.py --env .env --compose docker/docker-compose.release.yml --skip-runtime
```

Doctor checks:

- Docker and Docker Compose availability.
- Required `.env` values.
- Compose config validity.
- Port listening state.
- Backend `/health`.
- Frontend `/api/v1/release/current` reverse proxy.
- Alembic current revision when backend is running.

## Rollback

Rollback changes only the application image tag. It does not run database
downgrades.

Linux:

```bash
./scripts/rollback-private.sh 0.3.4-a1b2c3d
```

Windows PowerShell:

```powershell
.\scripts\rollback-private.ps1 -ImageTag 0.3.4-a1b2c3d
```

Use rollback for frontend/backend behavior regressions. For schema-breaking
database incidents, inspect the migration and data state before changing the
application image.

## Backup And Restore

Before customer upgrades, take volume/database backups.

Minimum PostgreSQL backup:

```bash
docker exec manufoundry-postgres pg_dump -U manufoundry manufoundry > backup.sql
```

Restore should be tested in a separate environment before replacing production
data.

## Release Manifest

Each release artifact includes `release-manifest.json` with:

- semantic version
- image tag
- Git commit
- short SHA
- backend image name/tag/digest when available
- frontend image name/tag/digest when available

Use this file to confirm exactly which build is installed or rolled back.
