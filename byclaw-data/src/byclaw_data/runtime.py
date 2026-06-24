"""Runtime helpers shared by byclaw-data entrypoints and plugins."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

_BY_DATACLOUD_DIRNAME = "by-datacloud"
_DEFAULT_DATACLOUD_ONTOLOGY_PATH = "/workspace/byclaw-data/resource/ontology"
_DEFAULT_DATACLOUD_MID_FTP_PATH = "/workspace/byclaw-data/resource/dig_employee"

_platform_initialized = False
_owl_loaded_path: str | None = None
"""Track which path was last loaded into the default base, for idempotent reload."""
_enterprise_initialized = False
"""Track whether enterprise base + CRM scene have been initialized."""


def _load_owl_into_default_base(base_path: str) -> Any:
    """Load OWL from *base_path* into the platform's default base via formal API.

    Protocol:
      1. ``platform.load_ontology("default", base_path)`` → OntologyLoader
      2. ``platform.inject_virtual_actions("default", loader)`` → inject query/compute

    Returns the loader handle so callers can build tools from it.

    This is the **function-based** import path.  Later the same logic can be
    exposed through an HTTP endpoint without changing the platform layer.
    """
    from datacloud_platform import get_platform

    p = get_platform()
    loader = p.load_ontology("default", base_path)
    p.inject_virtual_actions("default", loader)
    return loader


def _load_owl_if_configured() -> Any | None:
    """Load OWL from ``DATACLOUD_ONTOLOGY_PATH`` into the default base (idempotent).

    Called once during ``_init_platform_if_needed()``.
    Subsequent calls are no-ops unless the path changed.
    """
    global _owl_loaded_path
    ontology_path = os.environ.get("DATACLOUD_ONTOLOGY_PATH", "").strip()
    if not ontology_path:
        return None
    p = Path(ontology_path)
    if not p.is_absolute():
        p = Path.cwd() / p
    resolved = str(p.resolve())
    if not p.exists():
        return None
    if _owl_loaded_path == resolved:
        return None  # already loaded this path
    loader = _load_owl_into_default_base(resolved)
    _owl_loaded_path = resolved
    return loader


def _init_enterprise_base_and_scene() -> None:
    """Create enterprise ontology base and CRM scene, then attach all OWL
    objects and views as scene members.

    Does **not** reload OWL — OWL parsing is handled by
    ``_load_owl_if_configured()`` into the default base.  Object/view codes
    are hardcoded from the OWL resource layout; no filesystem scanning.

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
    enterprise_id = "enterprise"

    # ── 1. 创建企业本体库（幂等）──
    if not p.base_exists(enterprise_id):
        from datacloud_platform.base_entry import OntologyBaseEntry

        p.create_base(
            OntologyBaseEntry(
                base_id=enterprise_id,
                display_name="企业本体库",
                source_type="LOCAL",
            )
        )

    # ── 2. 创建 CRM 场景（幂等）──
    scene_id = "crm"
    try:
        p.create_scene(
            enterprise_id,
            {
                "scene_name": "CRM客户管理",
                "scene_code": scene_id,
                "scene_desc": "CRM场景，包含OWL导入的全部本体",
            },
        )
    except ValueError:
        pass  # scene already exists

    # ── 3. 将所有 OWL 对象和视图挂到 CRM 场景下（幂等，adapter 层去重）──
    p.add_scene_members(
        enterprise_id,
        scene_id,
        object_codes=[
            "by_customer",
            "by_opp_task",
            "by_opportunity",
            "by_project",
            "by_project_task",
            "by_rd_task",
            "po_organization",
            "po_users",
        ],
        view_codes=[
            "scene_crm_comprehensive_analysis",
            "scene_project_management",
            "scene_rd_management",
            "scene_sales_management",
        ],
    )


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

    from datacloud_platform.adapters.data_adapter import DataCloudDataBackend
    from datacloud_platform.adapters.knowledge_adapter import DataCloudKnowledgeBackend
    from datacloud_platform.adapters.local_execution_adapter import LocalExecutionBackend
    from datacloud_platform.adapters.none_adapters import (
        _NoopExecutionBackend,
        _NoopKnowledgeBackend,
        _NoopStorageBackend,
    )
    from datacloud_platform.backends.presets import register_preset
    from datacloud_platform.backends.registry import (
        register_backend_type,
        register_implementation,
    )
    from datacloud_platform import DatacloudPlatform, OntologyBaseEntry, OntologyBaseRegistry

    register_backend_type("ontology", "datacloud-data")
    register_backend_type("knowledge", "datacloud-knowledge")
    register_backend_type("execution", "local-exec")
    register_backend_type("storage", "datacloud-data")

    _onto = DataCloudDataBackend()
    _exec = LocalExecutionBackend()
    register_implementation("ontology", "datacloud-data", lambda: _onto)
    register_implementation("knowledge", "datacloud-knowledge", lambda: DataCloudKnowledgeBackend())
    register_implementation("knowledge", "none", lambda: _NoopKnowledgeBackend())
    register_implementation("execution", "local-exec", lambda: _exec)
    register_implementation("execution", "none", lambda: _NoopExecutionBackend())
    register_implementation("storage", "datacloud-data", lambda: _onto)
    register_implementation("storage", "none", lambda: _NoopStorageBackend())

    register_preset("LOCAL", {})

    registry = OntologyBaseRegistry()
    registry.register(
        OntologyBaseEntry(
            base_id="default",
            display_name="默认本地库",
            source_type="LOCAL",
        )
    )
    platform = DatacloudPlatform(_base_registry=registry)

    import datacloud_platform

    datacloud_platform._platform = platform
    _platform_initialized = True

    # ── 函数式导入 OWL（后续可由 HTTP API 替换调用路径）──
    _load_owl_if_configured()

    # ── 初始化企业本体库 + CRM 场景 + 挂载 OWL 本体 ──
    _ensure_enterprise_initialized()


def load_env_if_exists(*paths: Path) -> None:
    """Load dotenv files when present without overriding exported env vars."""

    for path in paths:
        if path.is_file():
            load_dotenv(path, override=False)


def locate_by_datacloud_repo_root(start: Path | None = None) -> Path | None:
    """Locate the sibling ``by-datacloud`` repository."""

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
    """Resolve the sibling ``by-datacloud`` repository."""

    repo_root = locate_by_datacloud_repo_root(start=start)
    if repo_root is not None:
        return repo_root
    raise FileNotFoundError(
        "Cannot locate by-datacloud. Set BY_DATACLOUD_REPO_DIR to the repository root "
        "that contains packages/datacloud-data and packages/datacloud-analysis."
    )


def normalize_runtime_environment() -> None:
    """Normalize env vars so byclaw-data consumes DATACLOUD-prefixed settings."""
    _init_platform_if_needed()

    _set_if_empty("DATACLOUD_ONTOLOGY_PATH", _DEFAULT_DATACLOUD_ONTOLOGY_PATH)
    _set_if_empty("DATACLOUD_MID_FTP_PATH", _DEFAULT_DATACLOUD_MID_FTP_PATH)
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
