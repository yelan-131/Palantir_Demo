"""Encrypt provider credentials at the database boundary, never in API responses."""
from __future__ import annotations

import base64
from copy import deepcopy
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

PREFIX = "enc:fernet:v1:"


def _cipher() -> Fernet:
    from app.config import settings
    secret = os.getenv("AI_SETTINGS_ENCRYPTION_KEY") or settings.SECRET_KEY
    if secret == "manufoundry-secret-key-change-in-production" or len(secret) < 32:
        raise RuntimeError("保存 AI 密钥需要配置至少 32 字符的 AI_SETTINGS_ENCRYPTION_KEY 或 SECRET_KEY")
    key = hashlib.sha256(("ai-provider-credentials:v1:" + secret).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def reveal_credentials(value: dict) -> dict:
    result = deepcopy(value)
    for name in ("apiKey", "api_key"):
        secret = result.get(name)
        if isinstance(secret, str) and secret.startswith(PREFIX):
            try:
                result[name] = _cipher().decrypt(secret[len(PREFIX):].encode()).decode()
            except InvalidToken:
                raise RuntimeError("AI 密钥解密失败，请恢复原加密密钥或重新配置凭据") from None
    for service in result.get('modelServices', []):
        service.update(reveal_credentials(service))
    return result


def protect_credentials(value: dict, *, previous: dict | None = None) -> dict:
    result = deepcopy(value)
    previous = previous or {}
    for name in ("apiKey", "api_key"):
        secret = result.get(name)
        if not secret:
            continue
        prior = previous.get(name)
        if isinstance(prior, str) and prior.startswith(PREFIX) and reveal_credentials({name: prior})[name] == secret:
            result[name] = prior
        else:
            result[name] = PREFIX + _cipher().encrypt(str(secret).encode()).decode()
    old_services = {s['id']: s for s in previous.get('modelServices', [])}
    result['modelServices'] = [protect_credentials(service, previous=old_services.get(service['id'])) for service in result['modelServices']] if 'modelServices' in result else result.get('modelServices', [])
    if 'modelServices' not in value:
        result.pop('modelServices', None)
    return result
