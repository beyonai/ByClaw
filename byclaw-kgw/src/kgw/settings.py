"""Environment-driven configuration for byclaw-kgw.

All config reads must go through ``get_settings()``. Modules MUST NOT
read os.environ directly; this keeps configuration auditable and
testable via monkeypatch.

Variables are read with the byclaw repo-level naming (DB_*, REDIS_*,
FILE_STORAGE_MINIO_*) so a single repo-level ``.env`` powers byclaw-be,
byclaw-qa, and byclaw-kgw consistently.
"""

from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables.

    Field names match the repo-level ``.env`` variable names (no
    ``KGW_`` prefix). Optional fields fall back to defaults that match
    the values in the repo-level ``.env.example``.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Database (PostgreSQL / OpenGauss PG-compatible) ----
    db_host: str = Field(...)
    db_port: int = Field(...)
    db_database: str = Field(...)
    db_schema: str = ""
    db_user: str = Field(...)
    db_pass: str = Field(...)
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10

    # ---- Redis ----
    redis_host: str = Field(...)
    redis_port: int = Field(...)
    redis_username: str = ""
    redis_password: str = ""
    redis_database: int = 0
    redis_auth_key_template: str = "user:{user_code}:login:auth"

    # ---- MinIO ----
    file_storage_minio_host: str = Field(..., alias="FILE_STORAGE_MINIO_HOST")
    file_storage_minio_api_port: int = Field(..., alias="FILE_STORAGE_MINIO_API_PORT")
    file_storage_minio_access_key: str = Field(
        ..., alias="FILE_STORAGE_MINIO_ACCESS_KEY"
    )
    file_storage_minio_secret_key: str = Field(
        ..., alias="FILE_STORAGE_MINIO_SECRET_KEY"
    )
    file_storage_minio_bucket_name: str = Field(
        ..., alias="FILE_STORAGE_MINIO_BUCKET_NAME"
    )
    file_storage_minio_secure: bool = Field(
        default=False, alias="FILE_STORAGE_MINIO_SECURE"
    )

    # KGW-specific defaults (not in repo .env, hard-coded as portal contract)
    minio_kg_doc_prefix: str = "resource/doc/KG_DOC_"

    # ---- HTTP client ----
    http_default_timeout_seconds: float = 30.0
    http_pool_max_connections: int = 200
    http_pool_max_keepalive: int = 50

    # ---- Audit ----
    audit_queue_max_size: int = 10_000

    # ---- Circuit breaker ----
    circuit_failure_threshold: int = 5
    circuit_open_duration: float = 30.0

    # ---- Ingest ----
    ingest_concurrency_limit: int = 100

    # ---- Computed views ----
    @computed_field
    @property
    def db_dsn(self) -> str:
        base = (
            f"postgresql://{quote(self.db_user)}:{quote(self.db_pass)}"
            f"@{self.db_host}:{self.db_port}/{self.db_database}"
        )
        if self.db_schema:
            return f"{base}?options=-csearch_path%3D{self.db_schema}"
        return base

    @computed_field
    @property
    def redis_url(self) -> str:
        auth = ""
        if self.redis_password:
            if self.redis_username:
                auth = f"{quote(self.redis_username)}:{quote(self.redis_password)}@"
            else:
                auth = f":{quote(self.redis_password)}@"
        return (
            f"redis://{auth}{self.redis_host}:{self.redis_port}/{self.redis_database}"
        )

    @computed_field
    @property
    def minio_endpoint(self) -> str:
        scheme = "https" if self.file_storage_minio_secure else "http"
        return (
            f"{scheme}://{self.file_storage_minio_host}"
            f":{self.file_storage_minio_api_port}"
        )

    # ---- Convenience aliases (read-only) ----
    @property
    def minio_access_key(self) -> str:
        return self.file_storage_minio_access_key

    @property
    def minio_secret_key(self) -> str:
        return self.file_storage_minio_secret_key

    @property
    def minio_bucket(self) -> str:
        return self.file_storage_minio_bucket_name

    @property
    def minio_secure(self) -> bool:
        return self.file_storage_minio_secure


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a process-wide Settings instance."""
    return Settings()
