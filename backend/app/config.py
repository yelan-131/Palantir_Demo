from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "ManuFoundry"
    APP_VERSION: str = "0.3.3"
    APP_MODE: str = "demo"
    DEBUG: bool = True

    POSTGRES_HOST: str = "127.0.0.1"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "manufoundry"
    POSTGRES_PASSWORD: str = "manufoundry123"
    POSTGRES_DB: str = "manufoundry"
    DATABASE_BACKEND: str = "auto"  # auto | postgresql | sqlite
    SQLITE_DB_PATH: str = ""

    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "manufoundry123"

    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    # Security ── single source of truth for JWT signing
    SECRET_KEY: str = "manufoundry-secret-key-change-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # 8h

    # Auth mode: when True, missing/invalid tokens fall back to a guest user
    # so existing demo endpoints continue to work without breaking changes.
    # Set to False in production to enforce 401 on protected routes.
    DEMO_AUTH_OPTIONAL: bool = True

    # CORS — comma-separated origins; "*" allowed but disables credentials.
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
    ]

    # Logging
    LOG_LEVEL: str = "INFO"

    # Optional integrations
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    AI_PROVIDER: str = "glm"
    AI_BASE_URL: str = "https://open.bigmodel.cn/api/paas/v4"
    AI_API_KEY: str = ""
    AI_CHAT_MODEL: str = "glm-5.1"
    AI_REASONING_MODEL: str = "glm-5.1"
    AI_EMBEDDING_MODEL: str = "embedding-3"
    AI_VISION_MODEL: str = "glm-4v-plus"
    AI_TIMEOUT_SECONDS: int = 30
    KNOWLEDGE_STORAGE_DIR: str = "storage/knowledge_assets"

    # Identity access center
    PASSWORD_MIN_LENGTH: int = 10
    PASSWORD_REQUIRE_COMPLEXITY: bool = True
    PASSWORD_HISTORY_COUNT: int = 3
    LOGIN_LOCK_THRESHOLD: int = 5
    LOGIN_LOCK_MINUTES: int = 15
    OIDC_ENABLED: bool = False
    OIDC_ISSUER: str = ""
    OIDC_AUTHORIZATION_ENDPOINT: str = ""
    OIDC_TOKEN_ENDPOINT: str = ""
    OIDC_USERINFO_ENDPOINT: str = ""
    OIDC_CLIENT_ID: str = ""
    OIDC_CLIENT_SECRET: str = ""
    OIDC_REDIRECT_URI: str = ""
    OIDC_SCOPES: str = "openid profile email"
    OIDC_USERNAME_CLAIM: str = "preferred_username"
    OIDC_EMAIL_CLAIM: str = "email"
    OIDC_DISPLAY_NAME_CLAIM: str = "name"
    OIDC_SUBJECT_CLAIM: str = "sub"
    OIDC_REQUIRE_PLATFORM_MFA: bool = False

    # Tenant onboarding and transactional email
    APP_PUBLIC_URL: str = "http://localhost:5173"
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "no-reply@manufoundry.local"
    SMTP_TLS: bool = True

    @property
    def IS_PRODUCTION(self) -> bool:
        return self.APP_MODE.lower() == "production"

    def validate_runtime(self) -> None:
        """Fail fast on unsafe production configuration."""
        mode = self.APP_MODE.lower()
        if mode not in {"demo", "production"}:
            raise ValueError("APP_MODE must be either 'demo' or 'production'")
        if not self.IS_PRODUCTION:
            return
        if self.DEMO_AUTH_OPTIONAL:
            raise ValueError("DEMO_AUTH_OPTIONAL must be false when APP_MODE=production")
        unsafe_secrets = {
            "manufoundry-secret-key-change-in-production",
            "change-me-to-a-long-random-string",
            "secret",
            "",
        }
        if self.SECRET_KEY in unsafe_secrets or len(self.SECRET_KEY) < 32:
            raise ValueError("SECRET_KEY must be a strong non-default value when APP_MODE=production")
        if "*" in self.CORS_ORIGINS:
            raise ValueError("CORS_ORIGINS must be explicit when APP_MODE=production")
        if not self.SMTP_HOST:
            raise ValueError("SMTP_HOST must be configured when APP_MODE=production")

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def DATABASE_URL_SYNC(self) -> str:
        return (
            f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
