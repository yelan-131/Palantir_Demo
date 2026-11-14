"""On-demand package release checks; never installs or changes the runtime."""
from importlib.metadata import PackageNotFoundError, version
from datetime import datetime, timezone
import httpx
from packaging.version import Version

async def check_harness_update():
    try:
        installed = version("deepseek-harness-sdk")
    except PackageNotFoundError:
        installed = None
    try:
        runtime = version("deepseek-harness-runtime-bin")
    except PackageNotFoundError:
        runtime = None
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get("https://pypi.org/pypi/deepseek-harness-sdk/json")
        response.raise_for_status()
        payload = response.json()
    # Include release candidates only when the installed SDK is itself a preview.
    allow_preview = bool(installed and Version(installed).is_prerelease)
    candidates = []
    for label, files in payload["releases"].items():
        candidate = Version(label)
        if not files or all(item.get("yanked", False) for item in files):
            continue
        if candidate.is_devrelease or (candidate.is_prerelease and not allow_preview):
            continue
        candidates.append(candidate)
    if not candidates:
        raise ValueError("No eligible package releases")
    latest = max(candidates)
    return {"currentVersion": installed, "runtimeVersion": runtime,
            "latestVersion": str(latest), "updateAvailable": bool(installed and latest > Version(installed)),
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "releaseUrl": f"https://pypi.org/project/deepseek-harness-sdk/{latest}/"}
