"""Runtime helpers shared by byclaw-data entrypoints and plugins."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from datacloud_platform.constants import DEFAULT_BASE_ID
from dotenv import load_dotenv

_BY_DATACLOUD_DIRNAME = "by-datacloud"
_DEFAULT_DATACLOUD_ONTOLOGY_PATH = "/workspace/byclaw-data/resource/ontology"
_DEFAULT_DATACLOUD_MID_FTP_PATH = "/workspace/byclaw-data/resource/dig_employee"

_platform_initialized = False
_enterprise_initialized = False
"""Track whether enterprise base + CRM scene have been initialized."""


def _init_enterprise_base_and_scene() -> None:
    """Create enterprise ontology base and CRM scene, then attach OWL
    objects and views as scene members.

    Object/view codes are hardcoded from the OWL resource layout;
    no filesystem scanning.

    Idempotent at every step:
    - ``create_base`` guarded by ``base_exists``
    - ``create_scene`` catches ``ValueError`` for duplicates
    - ``add_scene_members`` deduplicates internally (adapter level)

    Workflow:
      1. ``platform.create_base(\"enterprise\", ...)`` — 企业本体库
      2. ``platform.create_scene(\"enterprise\", scene)`` — CRM 场景
      3. ``platform.add_scene_members(enterprise, crm, objects, views)`` — 挂载
    """
    from datacloud_platform import get_platform

    p = get_platform()
    enterprise_id = DEFAULT_BASE_ID

    # ── 1. 创建企业本体库（幂等）──
    if not p.base_exists(enterprise_id):
        from datacloud_platform.base_entry import OntologyBaseEntry

        p.create_base(
            OntologyBaseEntry(
                base_id=enterprise_id,
                display_name="企业本体库",
                source_type="OPENGAUSS",
                backend_config={
                    "ontology": {
                        "base_path": os.environ.get("DATACLOUD_ONTOLOGY_PATH", ""),
                        "owl_path": os.environ.get("DATACLOUD_ONTOLOGY_PATH", ""),
                    }
                },
            )
        )

    # ── 2. 确保默认场景存在（幂等）──
    _ = p._ensure_default_scene(enterprise_id)


def _ensure_enterprise_initialized() -> None:
    """Idempotent wrapper: initialize enterprise base + CRM scene once per process."""
    global _enterprise_initialized
    if _enterprise_initialized:
        return
    _init_enterprise_base_and_scene()
    _enterprise_initialized = True


def _init_platform_if_needed() -> None:
    """Register 4-dimension backends + default base; inject global platform singleton (idempotent).

    Must be called before any ``import datacloud_analysis``, otherwise
    ``ontology_agent.py`` module load triggers
    ``get_platform()._default_base_id()`` → ``RuntimeError``.
    """
    global _platform_initialized
    if _platform_initialized:
        return

    _platform_initialized = True

    # ── 初始化企业本体库 + CRM 场景 ──
    _ensure_enterprise_initialized()


def load_env_if_exists(*paths: Path) -> None:
    """Load dotenv files when present without overriding exported env vars."""

    for path in paths:
        if path.is_file():
            load_dotenv(path, override=False)


def locate_by_datacloud_repo_root(start: Path | None = None) -> Path | None:
    """Locate the sibling ``by-datacloud`` repository.

    Resolution order:
    1. ``BY_DATACLOUD_REPO_DIR`` when set
    2. walking parent directories and looking for a sibling named ``by-datacloud``
    """

    configured = os.environ.get("BY_DATACLOUD_REPO_DIR", "").strip()
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if _is_by_datacloud_repo(candidate):
            return candidate

    anchor = (start or Path(__file__).resolve()).resolve()
    for parent in [anchor.parent, *anchor.parents]:
        candidate = (parent / _BY_DATACLOUD_DIRNAME).resolve()
        if _is_by_datacloud_repo(candidate):
            return candidate
    return None


def resolve_by_datacloud_repo_root(start: Path | None = None) -> Path:
    """Resolve the sibling ``by-datacloud`` repository or raise a clear error."""

    repo_root = locate_by_datacloud_repo_root(start=start)
    if repo_root is not None:
        return repo_root
    raise FileNotFoundError(
        "Cannot locate by-datacloud. Set BY_DATACLOUD_REPO_DIR to the repository root "
        "that contains packages/datacloud-data and packages/datacloud-analysis."
    )


def normalize_runtime_environment() -> None:
    """Normalize env vars so byclaw-data consumes DATACLOUD-prefixed settings."""

    _set_if_empty("DATACLOUD_ONTOLOGY_PATH", _DEFAULT_DATACLOUD_ONTOLOGY_PATH)
    _set_if_empty("DATACLOUD_MID_FTP_PATH", _DEFAULT_DATACLOUD_MID_FTP_PATH)

    _init_platform_if_needed()

    _set_first("DATACLOUD_DB_URL", "DB_URL")
    _set_first("DATACLOUD_DB_USER", "DB_USER")
    _set_first("DATACLOUD_DB_PASSWORD", "DATACLOUD_DB_PASS", "DB_PASS", "DB_PASSWORD")
    _set_first("DATACLOUD_GATEWAY_REDIS_HOST", "REDIS_HOST")
    _set_first("DATACLOUD_GATEWAY_REDIS_PORT", "REDIS_PORT")
    _set_first("DATACLOUD_GATEWAY_REDIS_USERNAME", "REDIS_USERNAME")
    _set_first("DATACLOUD_GATEWAY_REDIS_PASSWORD", "REDIS_PASSWORD")
    _set_first("DATACLOUD_GATEWAY_REDIS_DB", "REDIS_DATABASE")
    _set_first("DATACLOUD_LLM_API_BASE", "LLM_BASE_URL")
    _set_first("DATACLOUD_LLM_API_KEY", "LLM_API_KEY")
    _set_first("DATACLOUD_EMBEDDING_MODEL", "EMBEDDING_MODEL_NAME")
    _set_first("DATACLOUD_EMBEDDING_API_BASE", "EMBEDDING_BASE_URL")
    _set_first("DATACLOUD_EMBEDDING_API_KEY", "EMBEDDING_API_KEY")
    _set_first("DATACLOUD_EMBEDDING_DIMS", "EMBEDDING_DIMENSION")
    _set_first("DATACLOUD_EMBEDDING_BATCH_SIZE", "EMBEDDING_BATCH_SIZE")

    _set_if_empty(
        "BE_DOMAINNAME_URL",
        _compose_http_url(
            os.environ.get("HOST", "").strip(),
            os.environ.get("BE_SERVER_PORT", "").strip(),
        ),
    )
    _set_if_empty(
        "DATACLOUD_API_BASE_URL",
        _compose_http_url(
            os.environ.get("HOST", "").strip(),
            (
                os.environ.get("DATACLOUD_DATA_SERVICE_PORT", "").strip()
                or os.environ.get("DATACLOUD_PORT", "").strip()
            ),
        ),
    )

    _set_from_preferred(
        "OPENAI_API_KEY",
        "DATACLOUD_LLM_REASONING_API_KEY",
        "DATACLOUD_LLM_API_KEY",
        "OPENAI_API_KEY",
        "LLM_API_KEY",
        "DC_LLM_API_KEY",
    )
    _set_from_preferred(
        "OPENAI_BASE_URL",
        "DATACLOUD_LLM_REASONING_API_BASE",
        "DATACLOUD_LLM_API_BASE",
        "OPENAI_BASE_URL",
        "LLM_BASE_URL",
        "DC_LLM_BASE_URL",
    )
    _set_from_preferred(
        "DC_LLM_API_KEY",
        "DATACLOUD_LLM_API_KEY",
        "DATACLOUD_LLM_REASONING_API_KEY",
        "DC_LLM_API_KEY",
        "OPENAI_API_KEY",
        "LLM_API_KEY",
    )
    _set_from_preferred(
        "DC_LLM_BASE_URL",
        "DATACLOUD_LLM_API_BASE",
        "DATACLOUD_LLM_REASONING_API_BASE",
        "DC_LLM_BASE_URL",
        "OPENAI_BASE_URL",
        "LLM_BASE_URL",
    )
    _set_from_preferred(
        "DC_LLM_MODEL",
        "DATACLOUD_LLM_MODEL",
        "DATACLOUD_LLM_MODEL",
        "DC_LLM_MODEL",
    )
    _set_from_preferred(
        "DC_API_BASE_URL", "DATACLOUD_API_BASE_URL", "DC_API_BASE_URL"
    )
    from byclaw_data.model_environment import build_embedding_config, build_llm_config
    build_llm_config(None)
    build_embedding_config(None)


def _is_by_datacloud_repo(path: Path) -> bool:
    return (path / "packages" / "datacloud-data").is_dir() and (
        path / "packages" / "datacloud-analysis"
    ).is_dir()


def _set_first(target: str, *candidates: str) -> None:
    if os.environ.get(target, "").strip():
        return
    for name in candidates:
        value = os.environ.get(name, "").strip()
        if value:
            os.environ[target] = value
            return


def _set_from_preferred(target: str, *candidates: str) -> None:
    for name in candidates:
        value = os.environ.get(name, "").strip()
        if value:
            os.environ[target] = value
            return


def _set_if_empty(target: str, value: str) -> None:
    if os.environ.get(target, "").strip():
        return
    if value:
        os.environ[target] = value


def _compose_http_url(host: str, port: str) -> str:
    if not host or not port:
        return ""
    return f"http://{host}:{port}"
