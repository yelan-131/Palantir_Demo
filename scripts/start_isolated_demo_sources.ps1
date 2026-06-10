param(
    [string]$ApiBase = "http://127.0.0.1:8000/api/v1",
    [string]$SourceHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$python = Join-Path $root ".venv\Scripts\python.exe"
if (!(Test-Path $python)) {
    $python = Join-Path $root "backend\.venv\Scripts\python.exe"
}
if (!(Test-Path $python)) {
    throw "Python virtual environment was not found under .venv or backend\.venv."
}

$composeFile = Join-Path $root "docker\docker-compose.external-sources.yml"
docker compose -f $composeFile up -d
if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed with exit code $LASTEXITCODE."
}

function Invoke-CheckedPython {
    param([string[]]$Arguments)
    & $python $Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed with exit code $LASTEXITCODE`: $($Arguments -join ' ')"
    }
}

function Wait-PostgresReady {
    param(
        [string]$HostName,
        [int]$Port,
        [string]$Database,
        [string]$User,
        [string]$Password
    )

    $deadline = (Get-Date).AddSeconds(90)
    do {
        $code = @"
import psycopg2
conn = psycopg2.connect(host='$HostName', port=$Port, dbname='$Database', user='$User', password='$Password', connect_timeout=3)
conn.close()
"@
        $code | & $python -
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    throw "PostgreSQL source $Database did not become ready on port $Port."
}

$sources = @(
    @{ Database = "mf_mes_execution"; Port = 15432; Admin = "mf_mes_admin" },
    @{ Database = "mf_erp_core"; Port = 15433; Admin = "mf_erp_admin" },
    @{ Database = "mf_qms_quality"; Port = 15434; Admin = "mf_qms_admin" },
    @{ Database = "mf_wms_inventory"; Port = 15435; Admin = "mf_wms_admin" },
    @{ Database = "mf_scm_supply"; Port = 15436; Admin = "mf_scm_admin" },
    @{ Database = "mf_crm_sales"; Port = 15437; Admin = "mf_crm_admin" }
)

foreach ($source in $sources) {
    Wait-PostgresReady -HostName $SourceHost -Port $source.Port -Database $source.Database -User $source.Admin -Password "source_admin_123"

    Invoke-CheckedPython @(
        (Join-Path $root "scripts\create_demo_source_databases.py"),
        "--only", $source.Database,
        "--host", $SourceHost,
        "--port", [string]$source.Port,
        "--user", $source.Admin,
        "--password", "source_admin_123",
        "--admin-db", "postgres"
    )
}

Invoke-CheckedPython @(
    (Join-Path $root "scripts\register_demo_external_sources.py"),
    "--api-base", $ApiBase,
    "--source-host", $SourceHost,
    "--isolated"
)

Write-Host "Isolated demo data sources are ready."
Write-Host "MES  $SourceHost`:15432 / mf_mes_execution / mf_mes_readonly"
Write-Host "ERP  $SourceHost`:15433 / mf_erp_core / mf_erp_readonly"
Write-Host "QMS  $SourceHost`:15434 / mf_qms_quality / mf_qms_readonly"
Write-Host "WMS  $SourceHost`:15435 / mf_wms_inventory / mf_wms_readonly"
Write-Host "SCM  $SourceHost`:15436 / mf_scm_supply / mf_scm_readonly"
Write-Host "CRM  $SourceHost`:15437 / mf_crm_sales / mf_crm_readonly"
