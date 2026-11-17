param(
  [string]$EnvFile = ".env",
  [string]$ComposeFile = "docker/docker-compose.release.yml",
  [string]$Offline = ""
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

if (!(Test-Path $EnvFile)) { throw "Missing env file: $EnvFile" }
if (!(Test-Path $ComposeFile)) { throw "Missing compose file: $ComposeFile" }

function Read-EnvFile($Path) {
  $values = @{}
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) { return }
    $parts = $line.Split("=", 2)
    $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
  }
  return $values
}

if ($Offline) {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("palantir-offline-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  Expand-Archive -LiteralPath $Offline -DestinationPath $tmp -Force
  Get-ChildItem -Path $tmp -Recurse -Filter *.tar | ForEach-Object {
    docker load -i $_.FullName
  }
} else {
  $envs = Read-EnvFile $EnvFile
  if ($envs["GHCR_USERNAME"] -and $envs["GHCR_TOKEN"]) {
    $envs["GHCR_TOKEN"] | docker login ghcr.io -u $envs["GHCR_USERNAME"] --password-stdin
  }
  docker compose --env-file $EnvFile -f $ComposeFile pull backend frontend
}

python scripts/doctor.py --env $EnvFile --compose $ComposeFile --skip-runtime
docker compose --env-file $EnvFile -f $ComposeFile up -d postgres neo4j
docker compose --env-file $EnvFile -f $ComposeFile up -d backend frontend
docker exec manufoundry-backend alembic upgrade head
python scripts/doctor.py --env $EnvFile --compose $ComposeFile --wait 60
