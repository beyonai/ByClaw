from __future__ import annotations

import pytest

SHARED_ENV = {
    "DB_HOST": "127.0.0.1",
    "DB_PORT": "5432",
    "DB_DATABASE": "postgres",
    "DB_SCHEMA": "byai",
    "DB_USER": "gaussdb",
    "DB_PASS": "Admin@123",
    "REDIS_HOST": "127.0.0.1",
    "REDIS_PORT": "6379",
    "REDIS_USERNAME": "default",
    "REDIS_PASSWORD": "admin123",
    "REDIS_DATABASE": "0",
    "FILE_STORAGE_MINIO_HOST": "127.0.0.1",
    "FILE_STORAGE_MINIO_API_PORT": "9009",
    "FILE_STORAGE_MINIO_ACCESS_KEY": "ak",
    "FILE_STORAGE_MINIO_SECRET_KEY": "sk",
    "FILE_STORAGE_MINIO_SECURE": "false",
    "FILE_STORAGE_MINIO_BUCKET_NAME": "byclaw",
}


def test_settings_loads_shared_env(monkeypatch: pytest.MonkeyPatch):
    for k, v in SHARED_ENV.items():
        monkeypatch.setenv(k, v)

    from kgw.settings import Settings, get_settings

    get_settings.cache_clear()
    s = get_settings()

    assert isinstance(s, Settings)
    # Database
    assert s.db_host == "127.0.0.1"
    assert s.db_port == 5432
    assert s.db_database == "postgres"
    assert s.db_schema == "byai"
    assert s.db_user == "gaussdb"
    assert s.db_pass == "Admin@123"
    assert s.db_dsn == (
        "postgresql://gaussdb:Admin%40123@127.0.0.1:5432/postgres"
        "?options=-csearch_path%3Dbyai"
    )
    # Redis
    assert s.redis_host == "127.0.0.1"
    assert s.redis_port == 6379
    assert s.redis_password == "admin123"
    assert s.redis_database == 0
    assert s.redis_url == "redis://default:admin123@127.0.0.1:6379/0"
    # MinIO
    assert s.minio_endpoint == "http://127.0.0.1:9009"
    assert s.minio_access_key == "ak"
    assert s.minio_secret_key == "sk"
    assert s.minio_bucket == "byclaw"
    assert s.minio_secure is False
    # KGW-specific defaults (not in repo .env, hard-coded)
    assert s.minio_kg_doc_prefix == "resource/doc/KG_DOC_"
    assert s.redis_auth_key_template == "user:{user_code}:login:auth"
    assert s.http_default_timeout_seconds == 30.0


def test_settings_dsn_skips_search_path_when_schema_empty(
    monkeypatch: pytest.MonkeyPatch,
):
    for k, v in SHARED_ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("DB_SCHEMA", "")

    from kgw.settings import get_settings

    get_settings.cache_clear()
    s = get_settings()
    assert s.db_dsn == "postgresql://gaussdb:Admin%40123@127.0.0.1:5432/postgres"


def test_settings_redis_url_omits_auth_when_no_password(
    monkeypatch: pytest.MonkeyPatch,
):
    for k, v in SHARED_ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("REDIS_PASSWORD", raising=False)
    monkeypatch.delenv("REDIS_USERNAME", raising=False)

    from kgw.settings import get_settings

    get_settings.cache_clear()
    s = get_settings()
    assert s.redis_url == "redis://127.0.0.1:6379/0"


def test_settings_minio_secure_uses_https(monkeypatch: pytest.MonkeyPatch):
    for k, v in SHARED_ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("FILE_STORAGE_MINIO_SECURE", "true")

    from kgw.settings import get_settings

    get_settings.cache_clear()
    s = get_settings()
    assert s.minio_endpoint == "https://127.0.0.1:9009"


def test_settings_missing_required_field_raises(monkeypatch: pytest.MonkeyPatch):
    for var in (
        "DB_HOST",
        "DB_PORT",
        "DB_DATABASE",
        "DB_USER",
        "DB_PASS",
        "REDIS_HOST",
        "REDIS_PORT",
        "FILE_STORAGE_MINIO_HOST",
        "FILE_STORAGE_MINIO_API_PORT",
        "FILE_STORAGE_MINIO_ACCESS_KEY",
        "FILE_STORAGE_MINIO_SECRET_KEY",
        "FILE_STORAGE_MINIO_BUCKET_NAME",
    ):
        monkeypatch.delenv(var, raising=False)

    from kgw.settings import Settings, get_settings
    from pydantic import ValidationError
    from pydantic_settings import SettingsConfigDict

    # Patch env_file to a nonexistent path so .env on disk is not loaded.
    monkeypatch.setattr(
        Settings,
        "model_config",
        SettingsConfigDict(
            env_file="/nonexistent/.env",
            env_file_encoding="utf-8",
            extra="ignore",
            case_sensitive=False,
        ),
    )
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        get_settings()
