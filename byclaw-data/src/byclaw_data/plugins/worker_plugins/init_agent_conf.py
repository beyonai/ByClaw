"""Initialize DataCloud agent configs and emit diagnostic logs."""

from __future__ import annotations

import asyncio
import contextlib
import re
import json
import logging
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from by_framework import (
    AgentConfig,
    EventType,
    Plugin,
    PluginManifest,
    StreamChunkEvent,
)
from by_framework.core.protocol.content_type import SseMessageType
from dotenv import load_dotenv

from byclaw_data.runtime import (
    normalize_runtime_environment,
    resolve_by_datacloud_repo_root,
)
from langgraph.types import interrupt


logger = logging.getLogger(__name__)


# 环境变量名称常量
ENV_DISABLE_SSL_VERIFY = "DATACLOUD_DISABLE_SSL_VERIFY"
ENV_MID_FTP_PATH = "DATACLOUD_MID_FTP_PATH"

# 数字员工：扫描 / 解析文件名以 DIG_EMPLOYEE_ 或 BYAI_DIG_EMPLOYEE_ 开头且符合下述模式的 .json
_BYAI__DIG_EMPLOYEE_FILE_PREFIX = "BYAI_DIG_EMPLOYEE_"
_DIG_EMPLOYEE_FILE_PREFIX = "DIG_EMPLOYEE_"
_AGENT_FILE_PATTERN = re.compile(
    r"^(?:BYAI_)?DIG_EMPLOYEE_(.+)\.json$",
    re.IGNORECASE,
)
# JSON ``agentType``：正式数字员工为 005；本地/联调可用 debug（大小写不敏感）
_AGENT_TYPES_ALLOWED_LOAD = frozenset({"005", "010", "debug"})


@dataclass(slots=True)
class AgentReloadResult:
    """Result of loading or reloading DataCloud digital employee configs."""

    agent_configs: list[AgentConfig]
    loaded_agent_ids: list[str]
    changed_agent_ids: set[str] = field(default_factory=set)
    removed_agent_ids: set[str] = field(default_factory=set)
    failed_agent_ids: list[str] = field(default_factory=list)
    skipped_no_tools: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.changed_agent_ids or self.removed_agent_ids)


def _load_model_kwargs(env_key: str) -> dict:
    """从环境变量读取额外的 model_kwargs（JSON 格式），解析失败返回空 dict。"""
    raw = os.environ.get(env_key, "").strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        logger.warning("[_load_model_kwargs] invalid JSON for %s: %s", env_key, raw)
        return {}


def _is_employee_agent_json_filename(name: str) -> bool:
    """仅当文件名为 ``DIG_EMPLOYEE_<id>.json`` 或 ``BYAI_DIG_EMPLOYEE_<id>.json`` 时视为数字员工配置。"""

    if not name or not name.lower().endswith(".json"):
        return False
    if not name.upper().startswith(
        _DIG_EMPLOYEE_FILE_PREFIX
    ) and not name.upper().startswith(_BYAI__DIG_EMPLOYEE_FILE_PREFIX):
        return False
    return _AGENT_FILE_PATTERN.match(name) is not None


def _datacloud_repo_root() -> Path:
    """Resolve datacloud repo root or fall back to the byclaw-data project tree."""

    here = Path(__file__).resolve()
    try:
        return resolve_by_datacloud_repo_root(here)
    except FileNotFoundError:
        logger.warning(
            "Cannot find by-datacloud repo, falling back to byclaw-data project tree"
        )
        for parent in here.parents:
            if (parent / "resource" / "import_package_owl_onto").is_dir():
                return parent
            if (parent / "pyproject.toml").is_file():
                return parent
        return here.parent


def _byclaw_data_project_root() -> Path:
    """Resolve the local ``byclaw-data`` project root from this module path."""

    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "src" / "byclaw_data").is_dir():
            return parent
    return here.parent


class InitDataCloudDigitalEmployeePlugin(Plugin):
    """Load digital employee configs and dynamically build tools."""

    def __init__(self) -> None:
        super().__init__(
            manifest=PluginManifest(
                plugin_id="datacloud_init_agent_conf",
                version="1.0.0",
                priority=10,
                enabled=True,
            )
        )
        normalize_runtime_environment()
        self.loaded_agent_ids: list[str] = []
        self._reload_lock = asyncio.Lock()
        self._last_snapshot: dict[str, str] = {}
        self._agent_file_index: dict[str, Path] = {}
        self._watch_task: asyncio.Task[None] | None = None
        self._watch_poll_interval = float(
            os.environ.get("DATACLOUD_AGENT_RELOAD_POLL_INTERVAL", "3").strip() or "3"
        )
        repo_root = _datacloud_repo_root()
        datacloud_data_env_path = repo_root / "packages" / "datacloud-data" / ".env"
        if datacloud_data_env_path.is_file():
            load_dotenv(datacloud_data_env_path)
            logger.info(
                "[InitPlugin] Loaded datacloud-data env: path=%s",
                datacloud_data_env_path,
            )
        project_env_path = repo_root / ".env"
        if project_env_path.is_file():
            load_dotenv(project_env_path)
            logger.info("[InitPlugin] Loaded project env: path=%s", project_env_path)
        normalize_runtime_environment()

    async def on_worker_startup(self, worker: Any) -> None:
        if self._watch_task is None:
            self._watch_task = asyncio.create_task(self._watch_agent_files(worker))

    async def on_worker_shutdown(self, worker: Any) -> None:
        _ = worker
        if self._watch_task is not None:
            self._watch_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._watch_task
            self._watch_task = None

    @staticmethod
    def _default_workspace_dir() -> str:
        return str((Path(tempfile.gettempdir()) / "datacloud").resolve())

    @staticmethod
    def _mid_ftp_path() -> Path:
        """Read and validate the DATACLOUD_MID_FTP_PATH environment variable."""
        raw = os.environ.get(ENV_MID_FTP_PATH, "").strip()
        if not raw:
            raise ValueError(
                f"{ENV_MID_FTP_PATH} is not set. "
                "Set it to the directory containing DIG_EMPLOYEE_*.json or BYAI_DIG_EMPLOYEE_*.json files."
            )

        raw_path = Path(raw).expanduser()
        if raw_path.is_absolute():
            ftp_dir = raw_path
        else:
            project_root = _byclaw_data_project_root()
            project_relative_dir = (project_root / raw_path).resolve()
            cwd_relative_dir = raw_path.resolve()

            ftp_dir = project_relative_dir
            if not ftp_dir.exists() and cwd_relative_dir != project_relative_dir:
                ftp_dir = cwd_relative_dir

        if not ftp_dir.exists():
            details = f"{ENV_MID_FTP_PATH} directory does not exist: {ftp_dir}"
            if not raw_path.is_absolute():
                details = (
                    f"{details} (raw={raw!r}, "
                    f"project_root={_byclaw_data_project_root()}, cwd={Path.cwd()})"
                )
            raise FileNotFoundError(details)
        if not ftp_dir.is_dir():
            raise NotADirectoryError(
                f"{ENV_MID_FTP_PATH} is not a directory: {ftp_dir}"
            )
        return ftp_dir

    @staticmethod
    def _scan_agent_files(ftp_dir: Path) -> list[Path]:
        """Scan *ftp_dir*：仅文件名以 ``DIG_EMPLOYEE_`` 或 ``BYAI_DIG_EMPLOYEE_`` 开头的 ``.json`` 才纳入列表。"""
        files = [
            f
            for f in ftp_dir.iterdir()
            if f.is_file() and _is_employee_agent_json_filename(f.name)
        ]
        if not files:
            raise RuntimeError(
                f"No DIG_EMPLOYEE_*.json or BYAI_DIG_EMPLOYEE_*.json files found in {ENV_MID_FTP_PATH}: {ftp_dir}"
            )
        return sorted(files, key=lambda p: p.name)

    @staticmethod
    def _agent_id_from_file_path(path: Path) -> str:
        match = _AGENT_FILE_PATTERN.match(path.name)
        return str(match.group(1) if match else "").strip()

    @staticmethod
    def _agent_file_signature(path: Path) -> str:
        try:
            stat = path.stat()
        except OSError:
            return ""
        return f"{stat.st_mtime_ns}:{stat.st_size}"

    def _snapshot_agent_files(self, files: list[Path]) -> dict[str, str]:
        return {
            str(path.resolve()): self._agent_file_signature(path)
            for path in files
            if path.exists()
        }

    def _resolve_target_agent_files(
        self, ftp_dir: Path, target_agent_id: str
    ) -> list[Path]:
        wanted = str(target_agent_id or "").strip()
        if not wanted:
            return self._scan_agent_files(ftp_dir)

        candidates = [
            ftp_dir / f"{_DIG_EMPLOYEE_FILE_PREFIX}{wanted}.json",
            ftp_dir / f"{_BYAI__DIG_EMPLOYEE_FILE_PREFIX}{wanted}.json",
        ]
        found = [path for path in candidates if path.is_file()]
        if found:
            return sorted(found, key=lambda p: p.name)

        indexed = self._agent_file_index.get(wanted)
        if indexed and indexed.is_file():
            return [indexed]

        return []

    @staticmethod
    def _parse_agent_file(path: Path) -> dict[str, Any] | None:
        """Parse a single agent JSON file.

        Returns the parsed dict if ``agentType`` is allowed (``005`` or ``debug``),
        otherwise ``None``. Matching is case-insensitive for ``debug``.
        Logs a warning on parse errors and returns ``None`` so callers can skip.
        """
        if not _is_employee_agent_json_filename(path.name):
            logger.warning(
                "[InitPlugin] Refuse to read agent file (filename must start with %s): path=%s",
                _DIG_EMPLOYEE_FILE_PREFIX,
                path,
            )
            return None
        try:
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning(
                "[InitPlugin] Failed to parse agent file: path=%s err=%s", path, exc
            )
            return None

        if not isinstance(data, dict):
            logger.warning(
                "[InitPlugin] Agent file content is not a JSON object: path=%s", path
            )
            return None

        agent_type = str(data.get("agentType") or "").strip()
        type_key = agent_type.lower()
        if type_key not in _AGENT_TYPES_ALLOWED_LOAD:
            logger.debug(
                "[InitPlugin] Skip agent file (agentType=%r not in %s): path=%s",
                agent_type,
                sorted(_AGENT_TYPES_ALLOWED_LOAD),
                path,
            )
            return None

        return data

    async def register_agent_configs(self, agent_context: Any) -> list[AgentConfig]:
        """Load digital-employee configs during plugin initialization."""
        result = await self.reload_agents(
            registry=None,
            current_configs=agent_context.list_agent_configs(),
            reason="startup_register",
            target_agent_id=None,
            strict=False,
        )
        return result.agent_configs

    async def reload_agents(
        self,
        *,
        registry: Any | None,
        current_configs: list[AgentConfig] | None = None,
        reason: str,
        target_agent_id: str | None = None,
        strict: bool = False,
    ) -> AgentReloadResult:
        """Reload all or part of the digital employee config set."""

        async with self._reload_lock:
            baseline_configs = (
                list(current_configs)
                if current_configs is not None
                else list(getattr(registry, "agent_configs", []) or [])
            )
            result = self._build_reload_result(
                baseline_configs=baseline_configs,
                reason=reason,
                target_agent_id=target_agent_id,
                strict=strict,
            )
            if registry is not None:
                registry._agent_configs = list(result.agent_configs)
            return result

    def _build_reload_result(
        self,
        *,
        baseline_configs: list[AgentConfig],
        reason: str,
        target_agent_id: str | None,
        strict: bool,
    ) -> AgentReloadResult:
        ftp_dir = self._mid_ftp_path()
        logger.info(
            "[InitPlugin] Reload start: reason=%s dir=%s target_agent_id=%s",
            reason,
            ftp_dir,
            target_agent_id,
        )

        try:
            all_agent_files = self._scan_agent_files(ftp_dir)
        except RuntimeError:
            all_agent_files = []
            if strict:
                raise

        all_snapshot = self._snapshot_agent_files(all_agent_files)
        target_agent_key = str(target_agent_id or "").strip()
        load_files = (
            self._resolve_target_agent_files(ftp_dir, target_agent_key)
            if target_agent_key
            else all_agent_files
        )
        if target_agent_key and not load_files:
            logger.warning(
                "[InitPlugin] Reload target file missing: reason=%s target_agent_id=%s dir=%s",
                reason,
                target_agent_key,
                ftp_dir,
            )

        current_map = {cfg.agent_id: cfg for cfg in baseline_configs}
        previous_plugin_configs = {
            cfg.agent_id: cfg
            for cfg in baseline_configs
            if (
                isinstance(getattr(cfg, "extra", None), dict)
                and cfg.extra.get("_loaded_by_plugin") == self.plugin_id
            )
        }
        loaded_agent_ids: list[str] = []
        failed_agent_ids: list[str] = []
        skipped_no_tools: list[str] = []
        changed_agent_ids: set[str] = set()
        removed_agent_ids: set[str] = set()
        next_agent_file_index = dict(self._agent_file_index)
        for file_path in load_files:
            file_agent_id = self._agent_id_from_file_path(file_path)
            logger.info(
                "[InitPlugin] Loading agent file: reason=%s path=%s file_agent_id=%s",
                reason,
                file_path,
                file_agent_id,
            )

            detail_data = self._parse_agent_file(file_path)
            if detail_data is None:
                failed_agent_ids.append(file_agent_id or str(file_path))
                continue

            agent_id = str(detail_data.get("resourceId") or file_agent_id).strip()
            if not agent_id:
                logger.warning(
                    "[InitPlugin] Agent file has no resourceId and filename id is empty: path=%s",
                    file_path,
                )
                failed_agent_ids.append(str(file_path))
                continue

            previous_cfg = current_map.get(agent_id)
            did_load = self._handle_single_agent_detail(
                current_map=current_map,
                agent_id=agent_id,
                detail_data=detail_data,
                skipped_no_tools=skipped_no_tools,
                source_path=file_path,
            )
            if not did_load:
                failed_agent_ids.append(agent_id)
                continue

            loaded_agent_ids.append(agent_id)
            next_agent_file_index[agent_id] = file_path
            current_cfg = current_map.get(agent_id)
            if previous_cfg is not current_cfg:
                changed_agent_ids.add(agent_id)

        missing_agent_ids: set[str] = set()
        if target_agent_key:
            target_cfg = previous_plugin_configs.get(target_agent_key)
            target_source = ""
            if target_cfg and isinstance(target_cfg.extra, dict):
                target_source = str(target_cfg.extra.get("_source_path") or "").strip()
            if target_source and not Path(target_source).is_file():
                missing_agent_ids.add(target_agent_key)
        else:
            current_source_paths = set(all_snapshot)
            for agent_id, cfg in previous_plugin_configs.items():
                source_path = ""
                if isinstance(cfg.extra, dict):
                    source_path = str(cfg.extra.get("_source_path") or "").strip()
                if source_path and source_path not in current_source_paths:
                    missing_agent_ids.add(agent_id)

        for agent_id in sorted(missing_agent_ids):
            removed = current_map.pop(agent_id, None)
            next_agent_file_index.pop(agent_id, None)
            if removed is not None:
                removed_agent_ids.add(agent_id)

        self.loaded_agent_ids = sorted(
            agent_id
            for agent_id, cfg in current_map.items()
            if (
                isinstance(getattr(cfg, "extra", None), dict)
                and cfg.extra.get("_loaded_by_plugin") == self.plugin_id
            )
        )
        self._agent_file_index = next_agent_file_index
        self._last_snapshot = all_snapshot

        logger.info(
            "[InitPlugin] Reload result: reason=%s loaded=%d failed=%d changed=%s removed=%s current_loaded=%s",
            reason,
            len(loaded_agent_ids),
            len(failed_agent_ids),
            sorted(changed_agent_ids),
            sorted(removed_agent_ids),
            self.loaded_agent_ids,
        )
        if skipped_no_tools:
            logger.warning(
                "[InitPlugin] Skipped agents (no dynamic tools and no mounted_objects): %s",
                ", ".join(skipped_no_tools),
            )
        if strict and not self.loaded_agent_ids:
            raise RuntimeError("Startup failed: no digital employee config loaded.")

        return AgentReloadResult(
            agent_configs=list(current_map.values()),
            loaded_agent_ids=loaded_agent_ids,
            changed_agent_ids=changed_agent_ids,
            removed_agent_ids=removed_agent_ids,
            failed_agent_ids=failed_agent_ids,
            skipped_no_tools=skipped_no_tools,
        )

    async def _watch_agent_files(self, worker: Any) -> None:
        while True:
            try:
                await asyncio.sleep(max(self._watch_poll_interval, 1.0))
                ftp_dir = self._mid_ftp_path()
                try:
                    files = self._scan_agent_files(ftp_dir)
                except RuntimeError:
                    files = []
                snapshot = self._snapshot_agent_files(files)
                if snapshot == self._last_snapshot:
                    continue
                result = await self.reload_agents(
                    registry=worker.plugin_registry,
                    reason="file_watch",
                    target_agent_id=None,
                    strict=False,
                )
                if result.changed or result.failed_agent_ids:
                    worker.invalidate_agent_graph_cache(
                        result.changed_agent_ids | result.removed_agent_ids
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[InitPlugin] Agent file watch loop error: %s", exc)

    def _handle_single_agent_detail(
        self,
        *,
        current_map: dict[Any, AgentConfig],
        agent_id: str,
        detail_data: dict[str, Any],
        skipped_no_tools: list[str],
        source_path: Path | None = None,
    ) -> bool:
        dynamic_prompts = {
            "system_prompt": detail_data.get("resourceDesc", ""),
            "task_prompt": self._compile_task_prompt(detail_data),
        }
        prompt_preview = {
            key: str(value)[:200] for key, value in dynamic_prompts.items()
        }

        rel_resource_list = detail_data.get("relResourceList") or []
        if not isinstance(rel_resource_list, list):
            rel_resource_list = []
        dynamic_tools, build_diag = self._build_dynamic_tools_with_diagnostics(
            agent_id=agent_id,
            rel_resource_list=rel_resource_list,
        )
        tool_names = sorted(dynamic_tools.keys())
        reason_summary = list(build_diag.get("reason_summary") or [])

        # --- ontology_query 路径（固定，DATACLOUD_ONTOLOGY_LOAD_MODE 已废弃）---
        # query_*/compute_* 由 inject_virtual_actions → OntologyToolLoader 生成；
        # data_query_{code} 静态注册到 dynamic_tools，供 before_callback redirect 使用。
        mounted_objects: list[str] = []
        for rel in rel_resource_list:
            snapshot = self._rel_resource_snapshot(rel)
            resource_biz_type = snapshot["resourceBizType"]
            resource_code = snapshot["resourceCode"]
            if resource_biz_type in {"OBJECT", "VIEW"} and resource_code:
                mounted_objects.append(resource_code)

        shared_loader: Any = None
        if mounted_objects:
            shared_loader = self._build_shared_loader(rel_resource_list)

        # 始终注册 data_query_{code}：LLM 不直接调用，由 query_clarification_plugin
        # before_callback redirect 决策从 tools_map 中查找并执行。
        # 注意：data_query_* 不放入 dynamic_tools（LLM 可见），
        # 而是单独放入 redirect_tools，通过 extra["redirect_tools"] 传递，
        # 避免 LLM 直接看到并错误调用这些工具。
        redirect_tools: dict[str, Any] = {}
        if shared_loader is not None:
            from datacloud_analysis.tools.ontology_tool_loader import (  # noqa: PLC0415
                OntologyToolLoader as _OntologyToolLoader,
            )

            for rel in rel_resource_list:
                snapshot = self._rel_resource_snapshot(rel)
                resource_code = snapshot["resourceCode"]
                resource_biz_type = snapshot["resourceBizType"]
                if resource_biz_type not in {"OBJECT", "VIEW"} or not resource_code:
                    continue
                tool_name = f"data_query_{resource_code}"
                try:
                    redirect_tools[tool_name] = _OntologyToolLoader(
                        mounted_objects=[resource_code],
                        loader=shared_loader,
                    ).build_nl_query_tool(
                        resource_code=resource_code,
                        resource_biz_type=resource_biz_type,
                        resource_name=snapshot["resourceName"],
                        resource_desc=snapshot["resourceDesc"],
                    )
                    logger.debug(
                        "[InitPlugin] data_query redirect tool registered: agent_id=%s tool=%s",
                        agent_id,
                        tool_name,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "[InitPlugin] data_query tool build failed: agent_id=%s code=%s err=%s",
                        agent_id,
                        resource_code,
                        exc,
                    )

        skip_action_families: frozenset[str] = frozenset()

        tool_names = sorted(dynamic_tools.keys())

        logger.info(
            "[InitPlugin] Agent loaded: agent_id=%s prompt_keys=%s "
            "tool_count=%d tool_names=%s redirect_tool_names=%s mounted_objects=%s",
            agent_id,
            sorted(dynamic_prompts.keys()),
            len(tool_names),
            tool_names,
            sorted(redirect_tools.keys()),
            mounted_objects,
        )
        logger.info(
            "[InitPlugin] Agent prompt preview: agent_id=%s prompts=%s",
            agent_id,
            prompt_preview,
        )
        if reason_summary:
            logger.warning(
                "[InitPlugin] Tool diagnostic summary: agent_id=%s reasons=%s",
                agent_id,
                reason_summary,
            )

        # 无动态工具且无 OBJECT/VIEW 挂载时跳过注册，不中断 Worker 启动
        if not tool_names and not mounted_objects:
            skipped_no_tools.append(agent_id)
            logger.warning(
                "[InitPlugin] Skip agent (no tools, no mounted_objects): agent_id=%s reason_summary=%s",
                agent_id,
                reason_summary,
            )
            return False

        # 构建 tool_metadata：保存每个工具的原始配置信息
        tool_metadata = {}
        for rel in rel_resource_list:
            snapshot = self._rel_resource_snapshot(rel)
            resource_code = snapshot["resourceCode"]
            resource_biz_type = snapshot["resourceBizType"]

            if resource_biz_type in {"OBJECT", "VIEW"}:
                ontology_tool_key = f"query_{resource_code}"
                tool_metadata[ontology_tool_key] = {
                    "resource_code": resource_code,
                    "resource_biz_type": resource_biz_type,
                    "resource_type": snapshot["resourceType"],
                    "resource_name": snapshot["resourceName"],
                }
                data_query_key = f"data_query_{resource_code}"
                tool_metadata[data_query_key] = {
                    "resource_code": resource_code,
                    "resource_biz_type": resource_biz_type,
                    "resource_type": snapshot["resourceType"],
                    "resource_name": snapshot["resourceName"],
                }

        logger.info(
            "[InitPlugin] Agent tool_metadata: agent_id=%s tool_metadata=%s",
            agent_id,
            tool_metadata,
        )

        # 将 mounted_objects 传递给 AgentConfig
        current_map[agent_id] = AgentConfig(
            agent_id=agent_id,
            tools=dynamic_tools,
            prompts=dynamic_prompts,
            skills={},
            on_conflict="overwrite",
            extra={
                "tool_metadata": tool_metadata,
                "mounted_objects": mounted_objects,
                "loader": shared_loader,  # OntologyLoader 实例，供 create_agent 动态生成工具
                "skip_action_families": skip_action_families,
                # data_query_* 工具仅供 redirect，不暴露给 LLM，通过此字段传递到 tools_map
                "redirect_tools": redirect_tools,
                "_loaded_by_plugin": self.plugin_id,
                "_source_path": str(source_path.resolve()) if source_path else "",
            },
        )
        self._save_offline_cache(agent_id, detail_data)
        return True

    @staticmethod
    def _compile_task_prompt(detail: dict[str, Any]) -> str:
        parts: list[str] = []
        parts.append(f"{detail['corePersonaDefinition']}")
        return "\n\n".join(parts)

    @staticmethod
    def _rel_resource_snapshot(rel: dict[str, Any]) -> dict[str, str]:
        return {
            "resourceBizType": str(rel.get("resourceBizType") or ""),
            "resourceType": str(rel.get("resourceType") or ""),
            "resourceCode": str(rel.get("resourceCode") or ""),
            "resourceName": str(rel.get("resourceName") or ""),
            "resourceDesc": str(rel.get("resourceDesc") or ""),
        }

    def _build_dynamic_tools_with_diagnostics(
        self,
        *,
        agent_id: str,
        rel_resource_list: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        rel_summaries = [self._rel_resource_snapshot(rel) for rel in rel_resource_list]
        logger.info(
            "[InitPlugin][ToolLoad][Input] agent_id=%s rel_count=%d rel_resources=%s",
            agent_id,
            len(rel_summaries),
            rel_summaries,
        )

        ontology_candidates: list[dict[str, str]] = []
        delegate_candidates: list[dict[str, str]] = []
        filtered_resources: list[dict[str, Any]] = []
        for rel in rel_resource_list:
            snapshot = self._rel_resource_snapshot(rel)
            biz_type = snapshot["resourceBizType"]
            if biz_type in {"OBJECT", "VIEW"}:
                ontology_candidates.append(snapshot)
            elif biz_type == "AGENT":
                delegate_candidates.append(snapshot)
            else:
                filtered_resources.append(
                    {**snapshot, "reason": "condition_mismatch_filtered"}
                )

        logger.info(
            "[InitPlugin][ToolLoad][Classify] agent_id=%s ontology_candidates=%d delegate_candidates=%d "
            "filtered=%d filtered_resources=%s",
            agent_id,
            len(ontology_candidates),
            len(delegate_candidates),
            len(filtered_resources),
            filtered_resources,
        )

        ontology_tools, ontology_report = self._build_ontology_tools_with_diagnostics(
            agent_id=agent_id,
            rel_resource_list=rel_resource_list,
        )
        delegate_tools, delegate_report = self._build_delegate_tools_with_diagnostics(
            agent_id=agent_id,
            rel_resource_list=rel_resource_list,
        )
        collisions = sorted(set(ontology_tools) & set(delegate_tools))
        merged_tools = {**ontology_tools, **delegate_tools}

        reason_summary: list[str] = []
        if not rel_resource_list:
            reason_summary.append("upstream_rel_resource_list_empty")
        if filtered_resources:
            reason_summary.append(
                f"condition_mismatch_filtered:{len(filtered_resources)}"
            )
        if ontology_report["failed"]:
            reason_summary.append(
                f"ontology_build_failed:{len(ontology_report['failed'])}"
            )
        if delegate_report["failed"]:
            reason_summary.append(
                f"delegate_build_failed:{len(delegate_report['failed'])}"
            )
        if collisions:
            reason_summary.append(
                f"tool_name_collision_overwritten_by_delegate:{','.join(collisions)}"
            )
        if not merged_tools:
            reason_summary.append("final_dynamic_tools_empty")

        logger.info(
            "[InitPlugin][ToolLoad][Final] agent_id=%s ontology_tools=%s delegate_tools=%s merged_tools=%s "
            "tool_count=%d reason_summary=%s",
            agent_id,
            sorted(ontology_tools),
            sorted(delegate_tools),
            sorted(merged_tools),
            len(merged_tools),
            reason_summary,
        )
        return merged_tools, {
            "rel_resources": rel_summaries,
            "ontology_candidates": ontology_candidates,
            "delegate_candidates": delegate_candidates,
            "filtered_resources": filtered_resources,
            "ontology_report": ontology_report,
            "delegate_report": delegate_report,
            "collisions": collisions,
            "reason_summary": reason_summary,
        }

    def _build_ontology_tools_with_diagnostics(
        self,
        *,
        agent_id: str,
        rel_resource_list: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        report: dict[str, list[dict[str, Any]]] = {
            "built": [],
            "failed": [],
            "skipped": [],
        }
        tools: dict[str, Any] = {}

        if not rel_resource_list:
            report["skipped"].append({"reason": "upstream_rel_resource_list_empty"})
            return tools, report

        for rel in rel_resource_list:
            snapshot = self._rel_resource_snapshot(rel)
            resource_biz_type = snapshot["resourceBizType"]

            # 🆕 跳过 OBJECT/VIEW 类型，使用通用 query_objects 工具
            if resource_biz_type in {"OBJECT", "VIEW"}:
                report["skipped"].append(
                    {**snapshot, "reason": "object_view_use_generic_query_objects_tool"}
                )
                logger.info(
                    "[InitPlugin][ToolLoad][Ontology] agent_id=%s skip resource_code=%s: "
                    "OBJECT/VIEW use generic query_objects tool",
                    agent_id,
                    snapshot["resourceCode"],
                )
                continue

            report["skipped"].append(
                {**snapshot, "reason": "condition_mismatch_filtered"}
            )

        logger.info(
            "[InitPlugin][ToolLoad][OntologySummary] agent_id=%s built=%d failed=%d skipped=%d tool_count=%d "
            "tool_keys=%s",
            agent_id,
            len(report["built"]),
            len(report["failed"]),
            len(report["skipped"]),
            len(tools),
            sorted(tools),
        )
        return tools, report

    def _build_delegate_tools_with_diagnostics(
        self,
        *,
        agent_id: str,
        rel_resource_list: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        report: dict[str, list[dict[str, Any]]] = {
            "built": [],
            "failed": [],
            "skipped": [],
        }
        tools: dict[str, Any] = {}
        if not rel_resource_list:
            report["skipped"].append({"reason": "upstream_rel_resource_list_empty"})
            return tools, report

        for rel in rel_resource_list:
            snapshot = self._rel_resource_snapshot(rel)
            resource_code = snapshot["resourceCode"]
            if snapshot["resourceBizType"] != "AGENT":
                report["skipped"].append(
                    {**snapshot, "reason": "condition_mismatch_filtered"}
                )
                continue
            if not resource_code:
                report["skipped"].append(
                    {**snapshot, "reason": "missing_resource_code"}
                )
                continue
            try:
                from datacloud_analysis.tools.delegate import build_delegate_tool  # noqa: PLC0415

                resource_name = str(rel.get("resourceName") or resource_code)
                resource_desc = str(rel.get("resourceDesc") or "")
                tools[resource_code] = build_delegate_tool(
                    target_agent_type=resource_code,
                    agent_name=resource_name,
                    agent_desc=resource_desc,
                )
                report["built"].append({**snapshot, "tool_keys": [resource_code]})
                logger.info(
                    "[InitPlugin][ToolLoad][Delegate] agent_id=%s build_ok resource_code=%s tool_key=%s",
                    agent_id,
                    resource_code,
                    resource_code,
                )
            except Exception as exc:
                report["failed"].append(
                    {
                        **snapshot,
                        "reason": "matched_but_build_failed",
                        "error": str(exc),
                    }
                )
                logger.warning(
                    "[InitPlugin][ToolLoad][Delegate] agent_id=%s build_failed resource=%s err=%s",
                    agent_id,
                    snapshot,
                    exc,
                )

        logger.info(
            "[InitPlugin][ToolLoad][DelegateSummary] agent_id=%s built=%d failed=%d skipped=%d tool_count=%d "
            "tool_keys=%s",
            agent_id,
            len(report["built"]),
            len(report["failed"]),
            len(report["skipped"]),
            len(tools),
            sorted(tools),
        )
        return tools, report

    def _build_agent_delegate_tool(
        self,
        *,
        target_agent_type: str,
        agent_name: str,
        agent_desc: str,
    ) -> Any:
        """Build a tool that delegates to another agent via context.call_agent."""

        async def _tool(
            content: str | None = None, _context: Any = None, **params: Any
        ) -> Any:
            resolved_content = str(
                content
                or params.get("content")
                or params.get("question")
                or params.get("query")
                or params.get("description")
                or ""
            ).strip()
            if not resolved_content:
                resolved_content = f"Please handle request related to {agent_name}."

            if _context is None:
                logger.error(
                    "[AgentDelegate] context missing, cannot delegate: target=%s",
                    target_agent_type,
                )
                return (
                    f"Error: missing runtime context for delegated agent {agent_name}."
                )

            raw_delegate_policy = params.get("delegate_policy")
            delegate_policy = (
                dict(raw_delegate_policy)
                if isinstance(raw_delegate_policy, dict)
                else {}
            )
            delegate_mode = str(delegate_policy.get("mode") or "").strip().lower()
            wait_for_reply = bool(delegate_policy.get("wait_for_reply"))
            sync_wait = not delegate_policy or delegate_mode == "sync" or wait_for_reply

            raw_payload = params.get("payload")
            delegate_payload = (
                dict(raw_payload) if isinstance(raw_payload, dict) else {}
            )
            raw_metadata = params.get("metadata")
            delegate_metadata = (
                dict(raw_metadata) if isinstance(raw_metadata, dict) else {}
            )

            parent_session_id = str(getattr(_context, "session_id", "") or "").strip()
            current_command = getattr(_context, "current_command", None)
            current_extra_payload = (
                getattr(current_command, "extra_payload", {})
                if current_command is not None
                else {}
            )
            current_header = getattr(current_command, "header", None)
            current_header_metadata = (
                getattr(current_header, "metadata", {})
                if current_header is not None
                else {}
            )
            parent_agent_id = str(
                current_extra_payload.get("agent_id")
                or current_header_metadata.get("agent_id")
                or ""
            ).strip()
            parent_agent_name = str(
                current_extra_payload.get("agent_name")
                or current_header_metadata.get("agent_name")
                or ""
            ).strip()
            parent_conf_hash = str(
                current_header_metadata.get("conf_hash") or ""
            ).strip()
            parent_runtime_agent_type = str(
                getattr(_context, "current_agent_id", "") or ""
            ).strip()
            parent_resume_target = {
                "session_id": parent_session_id,
                "agent_id": parent_agent_id,
                "resume_via": "ResumeCommand.reply_data",
                "interrupt_reason": "AGENT_DELEGATE_WAIT",
            }
            delegate_metadata.setdefault("parent_resume_target", parent_resume_target)
            if parent_agent_id:
                delegate_metadata.setdefault("resume_agent_id", parent_agent_id)
            if parent_agent_name:
                delegate_metadata.setdefault("resume_agent_name", parent_agent_name)
            if parent_runtime_agent_type:
                delegate_metadata.setdefault(
                    "resume_agent_type", parent_runtime_agent_type
                )
            if parent_conf_hash:
                delegate_metadata.setdefault("resume_conf_hash", parent_conf_hash)
            # 将父 agent 的 thread_id 传给子 agent，子 agent 回调时带回，
            # 确保 ResumeCommand 能找到正确的 LangGraph checkpoint
            parent_thread_id = str(getattr(_context, "_langgraph_thread_id", "") or "")
            if parent_thread_id:
                delegate_metadata.setdefault("resume_thread_id", parent_thread_id)

            delegate_message_id = ""
            generate_message_id = getattr(_context, "generate_message_id", None)
            if callable(generate_message_id):
                try:
                    delegate_message_id = str(generate_message_id() or "").strip()
                except Exception:
                    logger.debug(
                        "[AgentDelegate] generate_message_id failed for target=%s",
                        target_agent_type,
                        exc_info=True,
                    )

            delegate_parent_message_id = ""
            resolve_delegate_parent_message_id = getattr(
                _context,
                "_resolve_delegate_parent_message_id",
                None,
            )
            if callable(resolve_delegate_parent_message_id):
                try:
                    delegate_parent_message_id = str(
                        resolve_delegate_parent_message_id() or ""
                    ).strip()
                except Exception:
                    logger.debug(
                        "[AgentDelegate] resolve delegate parent message id failed for target=%s",
                        target_agent_type,
                        exc_info=True,
                    )
            if not delegate_parent_message_id:
                delegate_parent_message_id = str(
                    getattr(_context, "message_id", "") or ""
                ).strip()
            if delegate_parent_message_id:
                delegate_metadata.setdefault(
                    "delegate_parent_message_id",
                    delegate_parent_message_id,
                )
                parent_resume_target.setdefault(
                    "delegate_parent_message_id",
                    delegate_parent_message_id,
                )

            # 构造委托参数，传给 interrupt，由 worker 负责实际调用 call_agent
            # 这样恢复时不会重复调用 call_agent（LangGraph 恢复会重跑节点，
            # interrupt() 之前的代码会再执行一遍，所以副作用必须放到 worker 侧）
            call_agent_kwargs: dict[str, Any] = {
                "target_agent_type": target_agent_type,
                "content": resolved_content,
                "wait_for_reply": True,
            }
            if delegate_message_id:
                call_agent_kwargs["message_id"] = delegate_message_id
            if delegate_parent_message_id:
                call_agent_kwargs["parent_message_id"] = delegate_parent_message_id
            if delegate_payload:
                call_agent_kwargs["payload"] = delegate_payload
            if delegate_metadata:
                call_agent_kwargs["metadata"] = delegate_metadata

            logger.info(
                "[AgentDelegate] delegating: target=%s sync_wait=%s content=%.100s",
                target_agent_type,
                sync_wait,
                resolved_content,
            )

            if sync_wait:
                # 只调 interrupt，不在 tool 里调 call_agent
                # worker 检测到 AGENT_DELEGATE_WAIT 后负责调 call_agent，然后静默等待
                # 子 agent 完成后发 ResumeCommand，interrupt() 返回子 agent 的结果
                child_result = interrupt(
                    {
                        "reason_code": "AGENT_DELEGATE_WAIT",
                        "target_agent_type": target_agent_type,
                        "target_agent_name": agent_name,
                        "delegate_content": resolved_content,
                        "call_agent_kwargs": call_agent_kwargs,
                    }
                )
                return child_result

            await _context.emit_chunk(
                StreamChunkEvent(
                    content=f"Delegating request to agent [{agent_name}]:\n\n{resolved_content}"
                ),
                event_type=EventType.ANSWER_DELTA.value,
                content_type=SseMessageType.text.value,
            )
            await _context.call_agent(**call_agent_kwargs)
            return f"Request has been delegated to [{agent_name}]."

        _tool.__doc__ = (
            f"Cross-agent delegate tool. Delegate to [{agent_name}]. "
            f"{agent_desc}\n"
            "`content` is the full task content to pass to target agent."
        )
        _tool._is_agent_delegate = True  # type: ignore[attr-defined]
        return _tool

    def _build_shared_loader(
        self, rel_resource_list: list[dict[str, Any]]
    ) -> Any | None:
        """Create and configure a shared OntologyLoader for all OBJECT/VIEW resources.

        Uses the first available scene path (same fixed candidates as _resolve_scene_path).
        OWL loading and virtual-action injection are delegated to OntologyToolLoader._build_loader.
        Returns None on failure so callers can degrade gracefully.
        """
        try:
            # Find scene path using first resource for logging context
            first_rel = rel_resource_list[0] if rel_resource_list else {}
            scene_path = self._resolve_scene_path(first_rel)
            if not scene_path:
                logger.warning(
                    "[InitPlugin] _build_shared_loader: no valid scene_path found, "
                    "OntologyToolLoader will have no loader"
                )
                return None

            from datacloud_analysis.tools.ontology_tool_loader import (  # noqa: PLC0415
                OntologyToolLoader as _OntologyToolLoader,
                configure_loader,
            )

            loader = _OntologyToolLoader._build_loader(Path(scene_path))
            logger.info(
                "[InitPlugin] _build_shared_loader: OWL load + inject done scene_path=%s",
                scene_path,
            )

            configure_loader(
                loader,
                model=os.environ.get(
                    "DATACLOUD_LLM_CODING_MODEL",
                    os.environ.get("DATACLOUD_LLM_MODEL", "Qwen/Qwen3-235B-A22B"),
                ),
                base_url=os.environ.get("DATACLOUD_LLM_API_BASE"),
                api_key=os.environ.get("DATACLOUD_LLM_API_KEY"),
                temperature=0.0,
                model_kwargs=(
                    _load_model_kwargs("DATACLOUD_LLM_CODING_MODEL_KWARGS")
                    or _load_model_kwargs("DATACLOUD_LLM_MODEL_KWARGS")
                    or None
                ),
                csv_base_dir=os.environ.get(
                    "DATACLOUD_GATEWAY_WORKSPACE_DIR", self._default_workspace_dir()
                ),
                sql_execution_mode="internal",
            )
            logger.info(
                "[InitPlugin] _build_shared_loader: loader ready scene_path=%s",
                scene_path,
            )
            return loader
        except Exception as exc:
            logger.warning(
                "[InitPlugin] _build_shared_loader: failed to create loader: %s", exc
            )
            return None

    def _resolve_scene_path(self, rel: dict[str, Any]) -> str:
        """Resolve ontology scene path.

        Only reads from DC_ONTOLOGY_PATH environment variable.
        Returns "" if not set or path does not exist.
        """
        dc_ontology = os.environ.get("DATACLOUD_ONTOLOGY_PATH", "").strip()
        if not dc_ontology:
            logger.warning(
                "[InitPlugin] DC_ONTOLOGY_PATH not set, scene path unavailable"
            )
            return ""

        p = Path(dc_ontology)
        if not p.is_absolute():
            p = Path.cwd() / p
        fixed_scene_dir = p.resolve()

        if fixed_scene_dir.exists():
            logger.info(
                "[InitPlugin] Using fixed scene path for test: path=%s rel_resource_code=%s",
                str(fixed_scene_dir),
                rel.get("resourceCode"),
            )
            return str(fixed_scene_dir)

        logger.warning(
            "[InitPlugin] DC_ONTOLOGY_PATH path does not exist: %s", fixed_scene_dir
        )
        return ""

    def _save_offline_cache(self, agent_id: str, detail_data: dict[str, Any]) -> None:
        base_dir = os.environ.get(
            "DATACLOUD_GATEWAY_WORKSPACE_DIR", self._default_workspace_dir()
        )
        cache_dir = Path(base_dir) / "agent_configs"
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            cache_file = cache_dir / f"agent_{agent_id}.json"
            with cache_file.open("w", encoding="utf-8") as handle:
                json.dump(detail_data, handle, ensure_ascii=False, indent=2)
        except Exception as exc:
            logger.warning("Cache save warning: %s", exc)
