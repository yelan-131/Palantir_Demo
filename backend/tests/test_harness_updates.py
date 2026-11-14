import asyncio
from unittest.mock import AsyncMock, patch
from app.services.ai.harness_updates import check_harness_update


def test_check_compares_versions_and_skips_yanked_releases():
    response = AsyncMock()
    response.raise_for_status = lambda: None
    response.json = lambda: {"releases": {"0.2.1rc2": [{}], "0.2.1": [{}], "0.3.0": [{"yanked": True}], "0.4.0": []}}
    with patch("app.services.ai.harness_updates.version", return_value="0.2.1rc2"), patch("httpx.AsyncClient.get", return_value=response):
        result = asyncio.run(check_harness_update())
    assert result["latestVersion"] == "0.2.1"
    assert result["updateAvailable"] is True


def test_stable_install_does_not_offer_preview():
    response = AsyncMock()
    response.raise_for_status = lambda: None
    response.json = lambda: {"releases": {"0.2.1": [{}], "0.3.0rc1": [{}]}}
    with patch("app.services.ai.harness_updates.version", return_value="0.2.1"), patch("httpx.AsyncClient.get", return_value=response):
        result = asyncio.run(check_harness_update())
    assert result["latestVersion"] == "0.2.1"
    assert result["updateAvailable"] is False
