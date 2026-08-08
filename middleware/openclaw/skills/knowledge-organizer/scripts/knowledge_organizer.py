#!/usr/bin/env python3
"""Durable CLI for initializing and submitting knowledge-organizer work."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import inspect
import json
import os
import shutil
import threading
from pathlib import Path
from typing import Any, Protocol


WORKFLOW_DIRECTORY = "knowledge-organizer"
STATE_FILE = "state.json"
OBJECT_FIELDS = ("objectCode", "objectName", "objectDesc", "properties")
SUPPORTED_SOURCE_SUFFIXES = {".md", ".txt", ".json"}
OBJECT_FILE_VERSION = "1.0.0"
OBJECT_FILE_STATUS_CD = "00A"


class OrganizerApi(Protocol):
    def list_authorized_resources(self, employee_resource_id: str, page: int) -> dict[str, Any]: ...

    def list_session_resources(self, *, session_id: str) -> dict[str, Any]: ...

    def get_object(self, object_code: str) -> dict[str, Any]: ...

    def save_object_files(self, *, object_files: list[dict[str, Any]]) -> list[dict[str, Any]]: ...

    def discover_document_objects(
        self, *, session_id: str, object_codes: list[str]
    ) -> dict[str, Any]: ...

    def enrich_document_objects(
        self, *, session_id: str, object_codes: list[str]
    ) -> dict[str, Any]: ...


class RpcTransport(Protocol):
    def request(
        self,
        *,
        service_env: str,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any: ...

    def close(self) -> None: ...


class ServiceApi:
    """Map organizer operations to backend and datacloud APIs."""

    def __init__(self, transport: RpcTransport) -> None:
        self.transport = transport

    def list_authorized_resources(self, employee_resource_id: str, page: int) -> dict[str, Any]:
        result = self.transport.request(
            service_env="BE_DOMAINNAME",
            method="POST",
            path="/byaiService/auth/privilegeGrant/queryDigEmployeeRelResourceAuth",
            payload={
                "resourceId": employee_resource_id,
                "keyword": "",
                "pageNum": page,
                "pageSize": 100,
            },
        )
        return result if isinstance(result, dict) else {}

    def list_session_resources(self, *, session_id: str) -> dict[str, Any]:
        result = self.transport.request(
            service_env="BE_DOMAINNAME",
            method="POST",
            path="/byaiService/devloop/operation/listObjectById",
            payload={"sessionId": session_id},
        )
        return result if isinstance(result, dict) else {}

    def get_object(self, object_code: str) -> dict[str, Any]:
        result = self.transport.request(
            service_env="DATACLOUD_DOMAINNAME",
            method="GET",
            path=f"/api/v1/ontologyBases/objects/{object_code}",
        )
        return result if isinstance(result, dict) else {}

    def save_object_files(self, *, object_files: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result = self.transport.request(
            service_env="BE_DOMAINNAME",
            method="POST",
            path="/byaiService/devloop/operation/saveOrUpdateObjectFiles",
            payload={"objectFiles": object_files},
        )
        return result if isinstance(result, list) else []

    def discover_document_objects(
        self, *, session_id: str, object_codes: list[str]
    ) -> dict[str, Any]:
        result = self.transport.request(
            service_env="DATACLOUD_DOMAINNAME",
            method="POST",
            path="/api/v1/rpc/kb/discoverDocumentObjectsAsync",
            payload={"params": {"objectCodes": object_codes}},
            headers={"X-Session-Id": session_id},
        )
        return result if isinstance(result, dict) else {}

    def enrich_document_objects(
        self, *, session_id: str, object_codes: list[str]
    ) -> dict[str, Any]:
        result = self.transport.request(
            service_env="DATACLOUD_DOMAINNAME",
            method="POST",
            path="/api/v1/rpc/kb/enrichDocumentObjectsAsync",
            payload={"params": {"objectCodes": object_codes}},
            headers={"X-Session-Id": session_id},
        )
        return result if isinstance(result, dict) else {}


async def _await_if_needed(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _first_non_empty_env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


def _env_int(default: int, *names: str) -> int:
    value = _first_non_empty_env(*names)
    if not value:
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{names[0]} 必须是整数: {value}") from exc


def _parse_redis_cluster_nodes(value: str) -> list[tuple[str, int]]:
    nodes: list[tuple[str, int]] = []
    for raw_node in value.split(","):
        node = raw_node.strip()
        if not node:
            continue
        host, separator, port = node.rpartition(":")
        if not separator:
            host, port = node, "6379"
        host = host.strip()
        if not host:
            raise ValueError(f"Redis 集群节点缺少 host: {node}")
        try:
            nodes.append((host, int(port) if port else 6379))
        except ValueError as exc:
            raise ValueError(f"Redis 集群节点端口无效: {node}") from exc
    return nodes


def _redis_config_from_env(redis_config_type: Any) -> Any:
    """Build a blank-safe standalone or cluster by-framework Redis config."""
    cluster_value = _first_non_empty_env(
        "REDIS_CLUSTER_HOST",
        "REDIS_CLUSTER_NODES",
    )
    cluster_nodes = _parse_redis_cluster_nodes(cluster_value)
    configured_mode = _first_non_empty_env("REDIS_MODE").lower()
    if configured_mode not in {"", "standalone", "cluster"}:
        raise ValueError(f"Redis mode 无效: {configured_mode}")
    mode = configured_mode or ("cluster" if cluster_nodes else "standalone")
    if mode == "cluster" and not cluster_nodes:
        raise ValueError("Redis cluster 模式缺少集群节点")

    return redis_config_type(
        host=_first_non_empty_env("REDIS_HOST", default="localhost"),
        port=_env_int(6379, "REDIS_PORT"),
        db=_env_int(
            0,
            "REDIS_DATABASE",
            "REDIS_DB",
        ),
        password=_first_non_empty_env("REDIS_PASSWORD"),
        username=_first_non_empty_env("REDIS_USERNAME") or None,
        mode=mode,
        cluster_nodes=cluster_nodes if mode == "cluster" else None,
    )


class ByFrameworkDiscoveryTransport:
    """Read the live login token and call a named service through discovery."""

    def __init__(self) -> None:
        self._closed = False
        self._loop = asyncio.new_event_loop()
        self._started = threading.Event()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self._started.wait()

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._started.set()
        self._loop.run_forever()

    def run(self, coroutine: Any) -> Any:
        if self._closed:
            coroutine.close()
            raise RuntimeError("服务发现运行时已关闭")
        return asyncio.run_coroutine_threadsafe(coroutine, self._loop).result()

    def request(
        self,
        *,
        service_env: str,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        return self.run(
            self._request(
                service_env=service_env,
                method=method,
                path=path,
                payload=payload,
                extra_headers=headers,
            )
        )

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._thread.join()
            self._loop.close()

    async def _request(
        self,
        *,
        service_env: str,
        method: str,
        path: str,
        payload: dict[str, Any] | None,
        extra_headers: dict[str, str] | None,
    ) -> Any:
        from by_framework.common.config import RedisConfig
        from by_framework.common.redis_client import init_redis
        from by_framework.core.discovery import DiscoveryClient
        from by_framework.util.discovery_http_client import DiscoveryHttpClient
        from by_framework.util.http_client import RetryConfig

        service_name = os.getenv(service_env, "").strip()
        user_code = os.getenv("USER_CODE", "").strip()
        if not service_name or not user_code:
            raise ValueError(f"{service_env} 和 USER_CODE 必须配置")

        redis_client = init_redis(config=_redis_config_from_env(RedisConfig))
        user_id = await _await_if_needed(redis_client.get(f"SHARE_BFM_USER_CODE_{user_code}"))
        if isinstance(user_id, bytes):
            user_id = user_id.decode("utf-8")
        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("Redis 中未找到 USER_CODE 对应的用户 ID")
        token = await _await_if_needed(
            redis_client.hget(f"user:{user_id}:login:auth", "Beyond-Token")
        )
        if isinstance(token, bytes):
            token = token.decode("utf-8")
        if not isinstance(token, str) or not token.strip():
            raise ValueError("Redis 登录态缺少 Beyond-Token，请重新登录")

        request_headers = {
            "Content-Type": "application/json",
            "Beyond-Token": token,
            "X-User-Code": user_code,
            **(extra_headers or {}),
        }
        discovery = DiscoveryClient(redis_client=redis_client, cache_interval=5)
        retry = RetryConfig(
            max_attempts=3,
            retry_on_status_codes=frozenset({502, 503, 504}),
        )
        try:
            async with DiscoveryHttpClient(discovery, retry_config=retry) as client:
                response = await client._request_with_discovery(
                    method=method,
                    service_name=service_name,
                    path=path,
                    headers=request_headers,
                    json=payload,
                )
        finally:
            await discovery.close()

        body = response.data if isinstance(response.data, dict) else {}
        success = body.get("success", body.get("code") in {0, 200})
        if not response.is_success or not isinstance(body, dict) or not success:
            raise ValueError(f"服务调用失败: {service_name}{path}")
        return body.get("data")


def production_api() -> ServiceApi:
    return ServiceApi(ByFrameworkDiscoveryTransport())


class KnowledgeOrganizer:
    """Own the initialized object snapshot and independent command submissions."""

    def __init__(self, api: OrganizerApi) -> None:
        self.api = api

    def initialize(
        self,
        task_dir: Path,
        *,
        session_id: str,
        employee_resource_id: str | None = None,
    ) -> dict[str, Any]:
        task_dir = task_dir.resolve()
        workflow_dir = task_dir / WORKFLOW_DIRECTORY
        if (workflow_dir / STATE_FILE).exists():
            raise ValueError(f"任务已初始化: {task_dir}")

        session_id = session_id.strip()
        employee_resource_id = employee_resource_id.strip() if employee_resource_id else None
        if not session_id:
            raise ValueError("session id is required")

        if employee_resource_id:
            resources = self._all_agent_objects(employee_resource_id)
            resource_scope = "agent"
        else:
            resources = self._all_session_objects(session_id=session_id)
            resource_scope = "session"
        if not resources:
            raise ValueError("未查询到授权对象")

        objects: list[dict[str, str]] = []
        seen_codes: set[str] = set()
        for resource in resources:
            object_code = self._resource_object_code(resource)
            if object_code in seen_codes:
                continue
            seen_codes.add(object_code)
            detail = self.api.get_object(object_code)
            if not isinstance(detail, dict):
                raise ValueError(f"对象详情无效: {object_code}")
            domain = self._object_domain(detail, object_code)
            filtered = self._filtered_object(detail, object_code)
            object_name = str(filtered["objectName"])
            object_file = (
                workflow_dir
                / "objects"
                / domain
                / f"{self._safe_file_component(object_name)}.json"
            )
            self._write_json(object_file, filtered)
            objects.append(
                {
                    "object_code": object_code,
                    "object_name": object_name,
                    "domain": domain,
                    "path": str(object_file),
                }
            )

        state = {
            "version": 2,
            "task_dir": str(task_dir),
            "session_id": session_id,
            "resource_scope": resource_scope,
            "employee_resource_id": employee_resource_id,
            "objects": objects,
            "ingestions": [],
            "discoveries": [],
            "enrichments": [],
        }
        self._write_json(workflow_dir / STATE_FILE, state)
        return {
            "status": "initialized",
            "task_dir": str(task_dir),
            "session_id": session_id,
            "resource_scope": resource_scope,
            "object_codes": {
                domain: [
                    item["object_code"]
                    for item in objects
                    if item["domain"] == domain
                ]
                for domain in ("ods", "ads")
            },
        }

    def ingest(
        self,
        task_dir: Path,
        *,
        source: Path,
        object_code: str,
        storage_file_name: str,
        ext_content: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        task_dir = task_dir.resolve()
        state = self._load_state(task_dir)
        source = source.resolve()
        self._validate_source(source)
        object_info = self._find_object(state, object_code)
        if object_info["domain"] != "ods":
            raise ValueError(f"ingest 只能使用 ODS 对象: {object_code}")
        self._validate_storage_file_name(storage_file_name)
        if ext_content is None:
            ext_content = {}
        if not isinstance(ext_content, dict):
            raise ValueError("ext content 必须是 JSON 对象")

        content = source.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        existing = self._existing_ingestion(state, digest, object_code)
        if existing is not None:
            return existing

        snapshot = self._snapshot_source(task_dir, source, digest)
        object_file = {
            "sessionId": str(state["session_id"]),
            "objectName": object_info["object_name"],
            "objectCode": object_code,
            "fileName": storage_file_name,
            "filePath": str(snapshot),
            "version": OBJECT_FILE_VERSION,
            "statusCd": OBJECT_FILE_STATUS_CD,
            "extContent": json.dumps(ext_content, ensure_ascii=False, separators=(",", ":")),
        }
        try:
            response = self.api.save_object_files(object_files=[object_file])
            saved = self._saved_object_file(response, object_code)
        except Exception as exc:
            state["ingestions"].append(
                {
                    "source_path": str(source),
                    "snapshot_path": str(snapshot),
                    "sha256": digest,
                    "object_code": object_code,
                    "status": "failed",
                    "error": str(exc),
                }
            )
            self._save_state(task_dir, state)
            raise

        record = {
            "source_path": str(source),
            "snapshot_path": str(snapshot),
            "sha256": digest,
            "object_code": object_code,
            "object_name": object_info["object_name"],
            "storage_file_name": storage_file_name,
            "ext_content": ext_content,
            "object_file_id": saved.get("id"),
            "status": "succeeded",
        }
        state["ingestions"].append(record)
        self._save_state(task_dir, state)
        return record

    def organize(
        self, task_dir: Path, object_codes: list[str] | None = None
    ) -> dict[str, Any]:
        """Submit a document-object discovery task for background processing."""
        return self._submit_background_task(
            task_dir,
            object_codes=object_codes,
            required_domain="ads",
            state_key="discoveries",
            expected_task_type="documentDiscovery",
            submit=self.api.discover_document_objects,
        )

    def build(
        self, task_dir: Path, object_codes: list[str] | None = None
    ) -> dict[str, Any]:
        """Submit a document-object enrichment task for background processing."""
        return self._submit_background_task(
            task_dir,
            object_codes=object_codes,
            required_domain="ads",
            state_key="enrichments",
            expected_task_type="documentEnrichment",
            submit=self.api.enrich_document_objects,
        )

    def _submit_background_task(
        self,
        task_dir: Path,
        *,
        object_codes: list[str] | None,
        required_domain: str,
        state_key: str,
        expected_task_type: str,
        submit: Any,
    ) -> dict[str, Any]:
        task_dir = task_dir.resolve()
        state = self._load_state(task_dir)
        normalized_codes = self._validated_object_codes(
            state,
            object_codes,
            required_domain=required_domain,
        )
        session_id = str(state.get("session_id") or "").strip()
        if not session_id:
            raise ValueError("任务状态缺少 session id")
        try:
            response = submit(session_id=session_id, object_codes=normalized_codes)
            if not isinstance(response, dict) or response.get("accepted") is not True:
                raise ValueError("后台任务响应未确认 accepted=true")
            response_session_id = response.get("sessionId")
            if response_session_id is not None and response_session_id != session_id:
                raise ValueError(f"后台任务会话不匹配: {response_session_id}")
            task_type = response.get("taskType")
            if task_type is not None and task_type != expected_task_type:
                raise ValueError(f"后台任务类型不匹配: {task_type}")
            record = {
                "session_id": session_id,
                "object_codes": normalized_codes,
                "task_type": task_type or expected_task_type,
                "accepted": True,
                "status": "accepted",
            }
        except Exception as exc:
            record = {
                "session_id": session_id,
                "object_codes": normalized_codes,
                "task_type": expected_task_type,
                "accepted": False,
                "status": "failed",
                "error": str(exc),
            }
            state[state_key].append(record)
            self._save_state(task_dir, state)
            raise
        state[state_key].append(record)
        self._save_state(task_dir, state)
        return record

    def _all_agent_objects(self, employee_resource_id: str) -> list[dict[str, Any]]:
        page = 1
        objects: list[dict[str, Any]] = []
        while True:
            response = self.api.list_authorized_resources(employee_resource_id, page)
            resources = response.get("list")
            if not isinstance(resources, list):
                raise ValueError("授权资源响应缺少 list")
            objects.extend(
                item
                for item in resources
                if isinstance(item, dict) and item.get("resourceBizType") == "OBJECT"
            )
            total_pages = int(response.get("totalPages") or 1)
            if page >= total_pages:
                return objects
            page += 1

    def _all_session_objects(self, *, session_id: str) -> list[dict[str, Any]]:
        response = self.api.list_session_resources(session_id=session_id)
        resources = response.get("items")
        if not isinstance(resources, list):
            raise ValueError("会话共享资源响应缺少 items")
        return [item for item in resources if isinstance(item, dict)]

    @staticmethod
    def _resource_object_code(resource: dict[str, Any]) -> str:
        object_code = str(resource.get("resourceCode") or resource.get("objectCode") or "").strip()
        if not object_code:
            raise ValueError("授权对象缺少 objectCode/resourceCode")
        return object_code

    @staticmethod
    def _object_domain(detail: dict[str, Any], object_code: str) -> str:
        ext_property = detail.get("extProperty")
        domain = ext_property.get("use_domain") if isinstance(ext_property, dict) else None
        if domain not in {"ods", "ads"}:
            raise ValueError(f"对象 {object_code} 的 use_domain 必须是 ods 或 ads")
        return str(domain)

    @staticmethod
    def _filtered_object(detail: dict[str, Any], object_code: str) -> dict[str, Any]:
        filtered = {field: detail.get(field) for field in OBJECT_FIELDS}
        if filtered["objectCode"] != object_code:
            raise ValueError(f"对象详情编码不匹配: {object_code}")
        if not isinstance(filtered["objectName"], str) or not filtered["objectName"].strip():
            raise ValueError(f"对象详情缺少 objectName: {object_code}")
        if not isinstance(filtered["properties"], list):
            raise ValueError(f"对象详情 properties 无效: {object_code}")
        return filtered

    @staticmethod
    def _safe_file_component(value: str) -> str:
        safe = value.replace("/", "_").replace("\\", "_").strip()
        if safe in {"", ".", ".."}:
            raise ValueError("对象名称不能作为文件名")
        return safe

    def _find_object(self, state: dict[str, Any], object_code: str) -> dict[str, str]:
        for item in state.get("objects", []):
            if isinstance(item, dict) and item.get("object_code") == object_code:
                return {key: str(value) for key, value in item.items()}
        raise ValueError(f"未找到已授权对象: {object_code}")

    def _validated_object_codes(
        self,
        state: dict[str, Any],
        object_codes: list[str] | None,
        *,
        required_domain: str,
    ) -> list[str]:
        normalized = list(
            dict.fromkeys(
                str(code).strip()
                for code in (object_codes or [])
                if str(code).strip()
            )
        )
        if not normalized:
            normalized = [
                str(item["object_code"])
                for item in state.get("objects", [])
                if isinstance(item, dict) and item.get("domain") == required_domain
            ]
        if not normalized:
            raise ValueError(f"未找到可用的 {required_domain.upper()} 对象")
        authorized = {
            str(item.get("object_code")): str(item.get("domain"))
            for item in state.get("objects", [])
            if isinstance(item, dict)
        }
        unknown = set(normalized) - set(authorized)
        if unknown:
            raise ValueError(f"包含未授权对象: {', '.join(sorted(unknown))}")
        wrong_domain = [
            code for code in normalized if authorized[code] != required_domain
        ]
        if wrong_domain:
            raise ValueError(
                f"只能使用 {required_domain.upper()} 对象: "
                + ", ".join(wrong_domain)
            )
        return normalized

    @staticmethod
    def _validate_source(source: Path) -> None:
        if source.suffix.lower() not in SUPPORTED_SOURCE_SUFFIXES or not source.is_file():
            raise ValueError("仅支持存在的 .md、.txt 或 .json 文件")

    @staticmethod
    def _validate_storage_file_name(value: str) -> None:
        path = Path(value)
        if (
            not value.strip()
            or path.name != value
            or path.suffix.lower() not in SUPPORTED_SOURCE_SUFFIXES
        ):
            raise ValueError("storage file name 必须是有语义的 .md、.txt 或 .json 文件名")
        if path.stem.lower() in {"document", "attachment", "附件", "附件1"}:
            raise ValueError("storage file name 缺少内容含义")

    @staticmethod
    def _snapshot_source(task_dir: Path, source: Path, digest: str) -> Path:
        destination = task_dir / "sources" / f"{digest[:12]}--{source.name}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            shutil.copyfile(source, destination)
        return destination

    @staticmethod
    def _saved_object_file(
        response: list[dict[str, Any]], object_code: str
    ) -> dict[str, Any]:
        if not response:
            raise ValueError("保存对象文件响应为空")
        matching = [
            item
            for item in response
            if isinstance(item, dict) and item.get("objectCode") == object_code
        ]
        saved = matching[0] if matching else response[0]
        if not isinstance(saved, dict) or saved.get("id") is None:
            raise ValueError("保存对象文件响应缺少 id")
        return saved

    @staticmethod
    def _existing_ingestion(
        state: dict[str, Any], digest: str, object_code: str
    ) -> dict[str, Any] | None:
        for ingestion in state.get("ingestions", []):
            if (
                isinstance(ingestion, dict)
                and ingestion.get("status") == "succeeded"
                and ingestion.get("sha256") == digest
                and ingestion.get("object_code") == object_code
            ):
                return ingestion
        return None

    @staticmethod
    def _write_json(path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(path)

    def _save_state(self, task_dir: Path, state: dict[str, Any]) -> None:
        self._write_json(task_dir / WORKFLOW_DIRECTORY / STATE_FILE, state)

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"JSON 对象无效: {path}")
        return payload

    def _load_state(self, task_dir: Path) -> dict[str, Any]:
        state_path = task_dir / WORKFLOW_DIRECTORY / STATE_FILE
        if not state_path.is_file():
            raise ValueError(f"未初始化任务目录: {task_dir}")
        state = self._read_json(state_path)
        if state.get("version") != 2:
            raise ValueError("任务状态版本不兼容，请重新执行 init")
        return state


def _json_object(value: str, parser: argparse.ArgumentParser, argument: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        parser.error(f"{argument} 不是合法 JSON: {exc}")
    if not isinstance(parsed, dict):
        parser.error(f"{argument} 必须是 JSON 对象")
    return parsed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Knowledge organizer CLI")
    commands = parser.add_subparsers(dest="command", required=True)

    init = commands.add_parser("init", help="初始化会话或数字员工授权对象快照")
    init.add_argument("--task-dir", required=True, type=Path)
    init.add_argument("--session-id", required=True)
    init.add_argument("--digital-employee-resource-id")

    ingest = commands.add_parser("ingest", help="保存一份对象文件信息")
    ingest.add_argument("--task-dir", required=True, type=Path)
    ingest.add_argument("--source", required=True, type=Path)
    ingest.add_argument("--object-code", required=True)
    ingest.add_argument("--storage-file-name", required=True)
    ingest.add_argument("--ext-content-json", default="{}")

    organize = commands.add_parser("organize", help="提交异步文档对象发现任务")
    organize.add_argument("--task-dir", required=True, type=Path)
    organize.add_argument("--object-code", action="append", dest="object_codes")

    build = commands.add_parser("build", help="提交异步文档对象整理融合任务")
    build.add_argument("--task-dir", required=True, type=Path)
    build.add_argument("--object-code", action="append", dest="object_codes")

    args = parser.parse_args(argv)
    api = production_api()
    organizer = KnowledgeOrganizer(api)
    try:
        if args.command == "init":
            result: Any = organizer.initialize(
                args.task_dir,
                session_id=args.session_id,
                employee_resource_id=args.digital_employee_resource_id,
            )
        elif args.command == "ingest":
            result = organizer.ingest(
                args.task_dir,
                source=args.source,
                object_code=args.object_code,
                storage_file_name=args.storage_file_name,
                ext_content=_json_object(
                    args.ext_content_json,
                    parser,
                    "ext-content-json",
                ),
            )
        elif args.command == "organize":
            result = organizer.organize(args.task_dir, args.object_codes)
        else:
            result = organizer.build(args.task_dir, args.object_codes)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    finally:
        api.transport.close()


if __name__ == "__main__":
    raise SystemExit(main())
