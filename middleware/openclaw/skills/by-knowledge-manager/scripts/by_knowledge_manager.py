#!/usr/bin/env python3
"""Knowledge-base management CLI backed by ByClaw backend APIs."""

from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import os
import tempfile
import threading
from contextlib import suppress
from pathlib import Path, PurePosixPath
from typing import Any, Protocol
from urllib.parse import unquote


BACKEND_SERVICE_ENV = "BE_DOMAINNAME"
BACKEND_PATH_PREFIX = "/byaiService/datasetController"
RESOURCE_ID_HEADER = "X-BYCLAW-RESOURCE-ID"
SESSION_ID_HEADER = "X-CHAT-SESSION-ID"
SESSION_AWARE_COMMANDS = frozenset(
    {
        "mkdir",
        "rename-dir",
        "delete-dir",
        "check-conflicts",
        "upload",
        "update-file",
        "build",
        "entity-discovery",
        "entity-enrich",
        "remove-file",
    }
)


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
        if not host.strip():
            raise ValueError(f"Redis 集群节点缺少 host: {node}")
        try:
            nodes.append((host.strip(), int(port) if port else 6379))
        except ValueError as exc:
            raise ValueError(f"Redis 集群节点端口无效: {node}") from exc
    return nodes


def _redis_config_from_env(redis_config_type: Any) -> Any:
    cluster_nodes = _parse_redis_cluster_nodes(
        _first_non_empty_env("REDIS_CLUSTER_HOST", "REDIS_CLUSTER_NODES")
    )
    configured_mode = _first_non_empty_env("REDIS_MODE").lower()
    if configured_mode not in {"", "standalone", "cluster"}:
        raise ValueError(f"Redis mode 无效: {configured_mode}")
    mode = configured_mode or ("cluster" if cluster_nodes else "standalone")
    if mode == "cluster" and not cluster_nodes:
        raise ValueError("Redis cluster 模式缺少集群节点")
    return redis_config_type(
        host=_first_non_empty_env("REDIS_HOST", default="localhost"),
        port=_env_int(6379, "REDIS_PORT"),
        db=_env_int(0, "REDIS_DATABASE", "REDIS_DB"),
        password=_first_non_empty_env("REDIS_PASSWORD"),
        username=_first_non_empty_env("REDIS_USERNAME") or None,
        mode=mode,
        cluster_nodes=cluster_nodes if mode == "cluster" else None,
    )


async def _await_if_needed(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _request_resource_id(
    *,
    payload: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    form_fields: dict[str, str] | None = None,
) -> str:
    for values in (payload, params, form_fields):
        if values and values.get("resourceId") not in {None, ""}:
            return str(values["resourceId"])
    resource_ids = payload.get("resourceIdList") if payload else None
    if isinstance(resource_ids, list) and len(resource_ids) == 1:
        return str(resource_ids[0])
    return ""


def _request_headers(
    auth_headers: dict[str, str],
    *,
    resource_id: str = "",
    json_content: bool = False,
) -> dict[str, str]:
    headers = dict(auth_headers)
    if resource_id:
        headers[RESOURCE_ID_HEADER] = resource_id
    if json_content:
        headers["Content-Type"] = "application/json"
    return headers


class ManagerTransport(Protocol):
    def request(
        self,
        *,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any: ...

    def upload(
        self,
        *,
        path: str,
        file_paths: list[Path],
        file_field: str,
        form_fields: dict[str, str],
    ) -> Any: ...

    def download(
        self,
        *,
        path: str,
        output: Path,
        params: dict[str, Any],
    ) -> dict[str, Any]: ...

    def close(self) -> None: ...


class ByFrameworkDiscoveryTransport:
    """Call the backend with Redis-backed login state and service discovery."""

    def __init__(
        self,
        *,
        session_id: str = "",
        supports_session: bool = False,
    ) -> None:
        self._closed = False
        self._session_id = _normalize_session_id(session_id)
        self._supports_session = supports_session
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
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        resource_id = _request_resource_id(payload=payload, params=params)
        return self.run(
            self._request(
                method=method,
                path=path,
                payload=payload,
                params=params,
                resource_id=resource_id,
                extra_headers=headers,
            )
        )

    def upload(
        self,
        *,
        path: str,
        file_paths: list[Path],
        file_field: str,
        form_fields: dict[str, str],
    ) -> Any:
        resource_id = _request_resource_id(form_fields=form_fields)
        return self.run(
            self._upload(
                path=path,
                file_paths=file_paths,
                file_field=file_field,
                form_fields=form_fields,
                resource_id=resource_id,
            )
        )

    def download(
        self,
        *,
        path: str,
        output: Path,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        resource_id = _request_resource_id(params=params)
        return self.run(
            self._download(
                path=path,
                output=output,
                params=params,
                resource_id=resource_id,
            )
        )

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join()
        self._loop.close()

    async def _runtime(self) -> tuple[Any, str, dict[str, str]]:
        from by_framework.common.config import RedisConfig
        from by_framework.common.redis_client import init_redis
        from by_framework.core.discovery import DiscoveryClient

        service_name = os.getenv(BACKEND_SERVICE_ENV, "").strip()
        user_code = os.getenv("USER_CODE", "").strip()
        supports_session = getattr(self, "_supports_session", False)
        session_id = ""
        if supports_session:
            session_id = getattr(self, "_session_id", "") or _normalize_session_id(
                _first_non_empty_env(
                    "BAIYING_SESSION",
                    "SESSION_ID",
                    "BYCLAW_SESSION",
                    "BYCLAW_ECOSYSTEM_SESSION",
                )
            )
        if not service_name or not user_code:
            raise ValueError(f"{BACKEND_SERVICE_ENV} 和 USER_CODE 必须配置")

        redis_client = init_redis(config=_redis_config_from_env(RedisConfig))
        user_id = await _await_if_needed(
            redis_client.get(f"SHARE_BFM_USER_CODE_{user_code}")
        )
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
        headers = {
            "Beyond-Token": token,
            "X-User-Code": user_code,
        }
        if session_id:
            headers[SESSION_ID_HEADER] = session_id
        return DiscoveryClient(redis_client=redis_client, cache_interval=5), service_name, headers

    async def _request(
        self,
        *,
        method: str,
        path: str,
        payload: dict[str, Any] | None,
        params: dict[str, Any] | None,
        resource_id: str,
        extra_headers: dict[str, str] | None,
    ) -> Any:
        from by_framework.util.discovery_http_client import DiscoveryHttpClient
        from by_framework.util.http_client import RetryConfig

        discovery, service_name, headers = await self._runtime()
        retry = RetryConfig(
            max_attempts=3,
            retry_on_status_codes=frozenset({502, 503, 504}),
        )
        try:
            async with DiscoveryHttpClient(discovery, retry_config=retry) as client:
                request_headers = dict(headers)
                request_headers.update(extra_headers or {})
                response = await client._request_with_discovery(
                    method=method,
                    service_name=service_name,
                    path=path,
                    headers=_request_headers(
                        request_headers,
                        resource_id=resource_id,
                        json_content=True,
                    ),
                    params=params,
                    json=payload,
                )
        finally:
            await discovery.close()
        return self._response_data(response, path)

    async def _upload(
        self,
        *,
        path: str,
        file_paths: list[Path],
        file_field: str,
        form_fields: dict[str, str],
        resource_id: str,
    ) -> Any:
        from by_framework.util.discovery_http_client import DiscoveryHttpClient
        from by_framework.util.http_client import RetryConfig

        discovery, service_name, headers = await self._runtime()
        retry = RetryConfig(
            max_attempts=3,
            retry_on_status_codes=frozenset({502, 503, 504}),
        )
        try:
            async with DiscoveryHttpClient(discovery, retry_config=retry) as client:
                response = await client.upload_multiple(
                    service_name,
                    path,
                    file_paths,
                    file_field=file_field,
                    headers=_request_headers(headers, resource_id=resource_id),
                    form_fields=form_fields,
                )
        finally:
            await discovery.close()
        return self._response_data(response, path)

    async def _download(
        self,
        *,
        path: str,
        output: Path,
        params: dict[str, Any],
        resource_id: str,
    ) -> dict[str, Any]:
        from by_framework.util.discovery_http_client import DiscoveryHttpClient
        from by_framework.util.http_client import RetryConfig

        discovery, service_name, headers = await self._runtime()
        retry = RetryConfig(
            max_attempts=3,
            retry_on_status_codes=frozenset({502, 503, 504}),
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{output.name}.", suffix=".part", dir=output.parent
        )
        os.close(descriptor)
        temporary_path = Path(temporary_name)
        try:
            async with DiscoveryHttpClient(discovery, retry_config=retry) as client:
                response = await client.download(
                    service_name,
                    path,
                    temporary_path,
                    headers=_request_headers(headers, resource_id=resource_id),
                    params=params,
                )
            if not response.is_success:
                raise ValueError(
                    f"HTTP {response.status_code} {path}: {response.data or 'download failed'}"
                )
            content_type = _header(response.headers, "content-type")
            if "application/json" in content_type.lower():
                body = json.loads(temporary_path.read_text(encoding="utf-8"))
                self._unwrap_body(body, path)
                raise ValueError("下载接口返回 JSON，未返回文件内容")
            os.replace(temporary_path, output)
            disposition = _header(response.headers, "content-disposition")
            return {
                "output": str(output),
                "bytes": output.stat().st_size,
                "contentType": content_type,
                "fileName": _content_disposition_filename(disposition),
            }
        finally:
            await discovery.close()
            with suppress(FileNotFoundError):
                temporary_path.unlink()

    @classmethod
    def _response_data(cls, response: Any, path: str) -> Any:
        if not response.is_success:
            message = response.data
            if isinstance(message, dict):
                message = message.get("msg") or message.get("message") or message
            raise ValueError(f"HTTP {response.status_code} {path}: {message}")
        return cls._unwrap_body(response.data, path)

    @staticmethod
    def _unwrap_body(body: Any, path: str) -> Any:
        if not isinstance(body, dict):
            raise ValueError(f"接口响应不是 JSON 对象: {path}")
        code = body.get("code")
        success = body.get("success")
        if code not in {0, 200, "0", "200"} or success is False:
            message = body.get("msg") or body.get("message") or f"接口返回异常 code={code}"
            detail = body.get("data")
            if isinstance(detail, dict) and (
                detail.get("errorCode") or detail.get("errorList")
            ):
                message = f"{message}: {json.dumps(detail, ensure_ascii=False)}"
            raise ValueError(message)
        return body.get("data")


def _header(headers: dict[str, str], name: str) -> str:
    expected = name.lower()
    for key, value in headers.items():
        if key.lower() == expected:
            return str(value)
    return ""


def _content_disposition_filename(value: str) -> str:
    if not value:
        return ""
    fallback = ""
    for part in value.split(";"):
        key, separator, raw_value = part.strip().partition("=")
        if not separator:
            continue
        if key.lower() == "filename*":
            return unquote(raw_value.strip('"').removeprefix("UTF-8''"))
        if key.lower() == "filename":
            fallback = unquote(raw_value.strip('"'))
    return fallback


def _compact(value: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item
        for key, item in value.items()
        if item is not None and item != "" and item != [] and item != {}
    }


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_session_id(value: Any) -> str:
    session_id = str(value or "").strip()
    while (
        len(session_id) >= 2
        and session_id[0] in {"'", '"'}
        and session_id[-1] == session_id[0]
    ):
        session_id = session_id[1:-1].strip()
    return session_id


class BackendApi:
    """Map skill operations to the backend's resourceId-based interfaces."""

    def __init__(self, transport: ManagerTransport) -> None:
        self.transport = transport

    @staticmethod
    def _path(suffix: str) -> str:
        return f"{BACKEND_PATH_PREFIX}/{suffix.lstrip('/')}"

    def create_directory(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("createFolder"), payload=payload)

    def rename_directory(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("renameFolder"), payload=payload)

    def delete_directory(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("deleteFolder"), payload=payload)

    def list_directory(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("queryDirAndFileByLevel"), payload=payload)

    def check_conflicts(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("checkUploadFileConflicts"), payload=payload)

    def upload_files(self, *, files: list[Path], form_fields: dict[str, str]) -> Any:
        return self.transport.upload(
            path=self._path("uploadFiles"),
            file_paths=files,
            file_field="files",
            form_fields=form_fields,
        )

    def update_file(self, *, file: Path, form_fields: dict[str, str]) -> Any:
        return self.transport.upload(
            path=self._path("knowledgeItems/update"),
            file_paths=[file],
            file_field="fileContent",
            form_fields=form_fields,
        )

    def build(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("build"), payload=payload)

    def build_status(self, *, resource_id: int, file_path: str) -> Any:
        return self.transport.request(
            method="GET",
            path=self._path("fileBuildStatus"),
            params={"resourceId": resource_id, "directoryPath": file_path},
        )

    def download(self, *, resource_id: int, target_path: str, output: Path) -> dict[str, Any]:
        return self.transport.download(
            path=self._path("download"),
            output=output,
            params={"resourceId": resource_id, "directoryPath": target_path},
        )

    def read_file(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("readFile"), payload=payload)

    def search(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("knowledgeItems/search"), payload=payload)

    def search_file(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("knowledgeItems/searchFile"), payload=payload)

    def entity_discovery(
        self,
        payload: dict[str, Any],
        *,
        session_id: str = "",
    ) -> Any:
        return self.transport.request(
            method="POST",
            path=self._path("knowledgeItems/entityDiscovery"),
            payload=payload,
            headers={SESSION_ID_HEADER: session_id} if session_id else None,
        )

    def entity_enrich(
        self,
        payload: dict[str, Any],
        *,
        session_id: str = "",
    ) -> Any:
        return self.transport.request(
            method="POST",
            path=self._path("knowledgeItems/entityEnrich"),
            payload=payload,
            headers={SESSION_ID_HEADER: session_id} if session_id else None,
        )

    def remove_file(self, payload: dict[str, Any]) -> Any:
        return self.transport.request(method="POST", path=self._path("removeFile"), payload=payload)


class KnowledgeManager:
    def __init__(self, api: BackendApi) -> None:
        self.api = api

    def execute(self, args: argparse.Namespace) -> dict[str, Any]:
        command = args.command
        handler = getattr(self, f"_{command.replace('-', '_')}")
        return handler(args)

    @staticmethod
    def _resource_id(args: argparse.Namespace) -> int:
        value = getattr(args, "resource_id", None)
        if not isinstance(value, int) or value <= 0:
            raise ValueError("--resource-id 必须是正整数")
        return value

    @staticmethod
    def _files(args: argparse.Namespace, *, exactly_one: bool = False) -> list[Path]:
        raw_files = getattr(args, "file_path", None) or []
        if isinstance(raw_files, str):
            raw_files = [raw_files]
        files = [Path(item).expanduser().resolve() for item in raw_files]
        if not files:
            raise ValueError("缺少 --file-path")
        if exactly_one and len(files) != 1:
            raise ValueError("update-file 只支持一个 --file-path")
        for file in files:
            if not file.is_file():
                raise ValueError(f"文件不存在: {file}")
        return files

    @staticmethod
    def _file_path_payload(resource_id: int, file_path: str) -> dict[str, Any]:
        return {"resourceId": resource_id, "directoryPath": file_path}

    def _mkdir(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = _compact(
            {
                "resourceId": self._resource_id(args),
                "directoryPath": args.directory_path,
                "directoryName": args.directory_name,
                "directoryDescription": args.directory_description,
            }
        )
        if args.dry_run:
            return {"ok": True, "action": "mkdir", "dryRun": True, "payload": payload}
        value = self.api.create_directory(payload)
        created = _compact(
            {
                "resourceId": payload["resourceId"],
                "directoryPath": value.get("directoryPath") if isinstance(value, dict) else None,
                "directoryName": value.get("directoryName") if isinstance(value, dict) else None,
                "directoryDescription": value.get("directoryDescription") if isinstance(value, dict) else None,
            }
        )
        return {"ok": True, "action": "mkdir", "created": created}

    def _rename_dir(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = {
            "resourceId": self._resource_id(args),
            "directoryPath": args.directory_path,
            "directoryName": args.directory_name,
        }
        if args.dry_run:
            return {"ok": True, "action": "rename-dir", "dryRun": True, "payload": payload}
        value = self.api.rename_directory(payload)
        renamed = _compact(
            {
                "resourceId": payload["resourceId"],
                "directoryPath": value.get("directoryPath") if isinstance(value, dict) else args.directory_path,
                "directoryName": value.get("directoryName") if isinstance(value, dict) else args.directory_name,
            }
        )
        return {"ok": True, "action": "rename-dir", "renamed": renamed}

    def _delete_dir(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = {"resourceId": self._resource_id(args), "directoryPath": args.directory_path}
        if args.dry_run:
            return {"ok": True, "action": "delete-dir", "dryRun": True, "payload": payload}
        return {"ok": True, "action": "delete-dir", "deleted": self.api.delete_directory(payload)}

    def _list(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = {"resourceId": self._resource_id(args), "directoryPath": args.directory_path}
        value = self.api.list_directory(payload)
        items = []
        for item in value if isinstance(value, list) else []:
            if isinstance(item, dict):
                items.append(_compact({"name": item.get("name"), "type": item.get("type"), "fileName": item.get("fileName")}))
        return {"ok": True, "action": "list", "items": items}

    def _check_conflicts(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = {
            "resourceId": self._resource_id(args),
            "directoryPath": args.directory_path,
            "fileNames": args.file_name,
        }
        if args.dry_run:
            return {"ok": True, "action": "check-conflicts", "dryRun": True, "payload": payload, "conflict": False, "needsOverwriteConfirmation": False, "overwritePaths": []}
        value = self.api.check_conflicts(payload)
        conflict = bool(value.get("conflict")) if isinstance(value, dict) else False
        return {
            "ok": True,
            "action": "check-conflicts",
            "conflict": conflict,
            "needsOverwriteConfirmation": conflict,
            "overwritePaths": value.get("overwritePaths", []) if isinstance(value, dict) else [],
        }

    def _upload_form(
        self, args: argparse.Namespace, *, overwrite: bool
    ) -> dict[str, str]:
        fields = {
            "resourceId": str(self._resource_id(args)),
            "directoryPath": args.directory_path,
            "processFrontMatter": str(args.process_front_matter).lower(),
            "overwrite": str(overwrite).lower(),
            "skipIfDuplicate": str(args.skip_if_duplicate).lower(),
        }
        if args.file_description is not None:
            fields["fileDescription"] = args.file_description
        return fields

    @staticmethod
    def _upload_result(value: Any, resource_id: int) -> dict[str, Any]:
        raw_items = value.get("uploadItems", []) if isinstance(value, dict) else []
        raw_failed_items = value.get("failedItems", []) if isinstance(value, dict) else []
        items = []
        for item in raw_items:
            if isinstance(item, dict):
                items.append(_compact({"fileName": item.get("fileName") or item.get("name"), "filePath": item.get("filePath") or item.get("path")}))
        failed_items = []
        for item in raw_failed_items:
            if isinstance(item, dict):
                failed_items.append(
                    _compact(
                        {
                            "fileName": item.get("fileName") or item.get("name"),
                            "filePath": item.get("filePath") or item.get("path"),
                            "error": item.get("error"),
                        }
                    )
                )
        result = {"resourceId": resource_id, "uploadItems": items}
        if failed_items:
            result["failedItems"] = failed_items
        if isinstance(value, dict) and value.get("summary"):
            result["summary"] = value["summary"]
        if isinstance(value, dict) and value.get("postProcessErrors"):
            result["postProcessErrors"] = value["postProcessErrors"]
        return result

    def _build_uploaded(self, resource_id: int, uploaded: dict[str, Any]) -> list[dict[str, Any]]:
        items = uploaded.get("uploadItems", [])
        if not items:
            raise ValueError("上传成功但未返回 uploadItems，无法触发构建")
        builds = []
        for item in items:
            file_path = item.get("filePath") if isinstance(item, dict) else None
            if not file_path:
                raise ValueError("uploadItems 中的文件缺少 filePath")
            built = self.api.build(self._file_path_payload(resource_id, file_path))
            builds.append({"filePath": file_path, "built": built})
        return builds

    def _upload(self, args: argparse.Namespace) -> dict[str, Any]:
        files = self._files(args)
        resource_id = self._resource_id(args)
        fields = self._upload_form(args, overwrite=False)
        if args.dry_run:
            return {"ok": True, "action": "upload", "dryRun": True, "resourceId": resource_id, "directoryPath": args.directory_path, "files": [str(file) for file in files], "processFrontMatter": args.process_front_matter, "skipIfDuplicate": args.skip_if_duplicate}
        if args.check_conflicts:
            conflict = self.api.check_conflicts(
                {"resourceId": resource_id, "directoryPath": args.directory_path, "fileNames": [file.name for file in files]}
            )
            if isinstance(conflict, dict) and conflict.get("conflict"):
                return {"ok": True, "action": "upload", "conflict": True, "needsOverwriteConfirmation": True, "overwritePaths": conflict.get("overwritePaths", [])}
        uploaded = self._upload_result(self.api.upload_files(files=files, form_fields=fields), resource_id)
        builds = self._build_uploaded(resource_id, uploaded)
        return {"ok": True, "action": "upload", "uploaded": uploaded, "builds": builds}

    def _update_file(self, args: argparse.Namespace) -> dict[str, Any]:
        file = self._files(args, exactly_one=True)[0]
        resource_id = self._resource_id(args)
        target_path = str(PurePosixPath(args.directory_path) / file.name)
        fields = {
            "resourceId": str(resource_id),
            "filePath": target_path,
            "processFrontMatter": str(args.process_front_matter).lower(),
        }
        if args.file_description is not None:
            fields["fileDescription"] = args.file_description
        if args.dry_run:
            return {"ok": True, "action": "update-file", "dryRun": True, "resourceId": resource_id, "filePath": target_path, "localFile": str(file)}
        self.api.update_file(file=file, form_fields=fields)
        built = self.api.build(self._file_path_payload(resource_id, target_path))
        return {"ok": True, "action": "update-file", "updated": {"resourceId": resource_id, "filePath": target_path}, "builds": [{"filePath": target_path, "built": built}]}

    def _build(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = self._file_path_payload(self._resource_id(args), args.file_path)
        if args.dry_run:
            return {"ok": True, "action": "build", "dryRun": True, "payload": payload}
        return {"ok": True, "action": "build", "built": self.api.build(payload)}

    def _build_status(self, args: argparse.Namespace) -> dict[str, Any]:
        resource_id = self._resource_id(args)
        return {"ok": True, "action": "build-status", "status": self.api.build_status(resource_id=resource_id, file_path=args.file_path)}

    def _download(self, args: argparse.Namespace) -> dict[str, Any]:
        if bool(args.file_path) == bool(args.directory_path):
            raise ValueError("download 只能传 --file-path 或 --directory-path 其中一个")
        target_type = "file" if args.file_path else "directory"
        target_path = args.file_path or args.directory_path
        if target_type == "directory" and not target_path.endswith("/"):
            target_path += "/"
        output = Path(args.output).expanduser().resolve()
        if args.dry_run:
            return {"ok": True, "action": "download", "dryRun": True, "resourceId": self._resource_id(args), "targetType": target_type, "path": target_path, "output": str(output)}
        result = self.api.download(resource_id=self._resource_id(args), target_path=target_path, output=output)
        return {"ok": True, "action": "download", "targetType": target_type, **result}

    def _read_file(self, args: argparse.Namespace) -> dict[str, Any]:
        resource_id = self._resource_id(args)
        payload = _compact({"resourceId": resource_id, "filePath": args.file_path, "startLine": args.start_line, "endLine": args.end_line})
        value = self.api.read_file(payload)
        value = value if isinstance(value, dict) else {}
        file = _compact({"resourceId": resource_id, "filePath": value.get("filePath"), "startLine": _as_int(value.get("startLine")), "endLine": _as_int(value.get("endLine")), "content": value.get("data"), "reachedEof": value.get("reachedEof")})
        return {"ok": True, "action": "read-file", "file": file}

    def _search_payload(self, args: argparse.Namespace) -> dict[str, Any]:
        if any(resource_id <= 0 for resource_id in args.resource_id):
            raise ValueError("--resource-id 必须是正整数")
        if args.top_k <= 0:
            raise ValueError("--top-k 必须是正整数")
        return _compact(
            {
                "resourceIdList": args.resource_id,
                "query": args.query,
                "where": args.where_json,
                "metadataFieldList": args.metadata_field,
                "topK": args.top_k,
                "searchMode": args.search_mode,
            }
        )

    def _search(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = self._search_payload(args)
        value = self.api.search(payload)
        raw_items = value.get("data", []) if isinstance(value, dict) else []
        items = [_compact({"resourceId": _as_int(item.get("resourceId")), "filePath": item.get("filePath"), "chunkNo": _as_int(item.get("chunkNo")), "chunkText": item.get("chunkText"), "score": item.get("score"), "imagePath": item.get("imagePath"), "startLine": _as_int(item.get("startLine")), "endLine": _as_int(item.get("endLine")), "metadata": item.get("metadata")}) for item in raw_items if isinstance(item, dict)]
        return {
            "ok": True,
            "action": "search",
            "resourceIds": args.resource_id,
            "query": args.query,
            "where": args.where_json,
            "metadataFields": args.metadata_field or [],
            "searchMode": args.search_mode,
            "topK": args.top_k,
            "items": items,
        }

    def _search_file(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = self._search_payload(args)
        value = self.api.search_file(payload)
        raw_items = value.get("data", []) if isinstance(value, dict) else []
        items = [_compact({"resourceId": _as_int(item.get("resourceId")), "filePath": item.get("filePath"), "score": item.get("score"), "metadata": item.get("metadata")}) for item in raw_items if isinstance(item, dict)]
        return {
            "ok": True,
            "action": "search-file",
            "resourceIds": args.resource_id,
            "query": args.query,
            "where": args.where_json,
            "metadataFields": args.metadata_field or [],
            "searchMode": args.search_mode,
            "topK": args.top_k,
            "items": items,
        }

    @staticmethod
    def _entity_batch(value: Any, *, resource_id: int) -> dict[str, Any]:
        if not isinstance(value, dict) or not str(value.get("batchId") or "").strip():
            raise ValueError("实体处理接口受理成功但未返回 batchId")
        raw_tasks = value.get("tasks", [])
        tasks = [
            _compact(
                {
                    "taskId": item.get("taskId"),
                    "status": item.get("status"),
                    "fileId": item.get("fileId"),
                    "filePath": item.get("filePath"),
                    "reused": item.get("reused"),
                    "skipReason": item.get("skipReason"),
                }
            )
            for item in raw_tasks
            if isinstance(item, dict)
        ] if isinstance(raw_tasks, list) else []
        batch = _compact(
            {
                "resourceId": _as_int(value.get("resourceId")) or resource_id,
                "batchId": value.get("batchId"),
                "scope": value.get("scope"),
                "taskType": value.get("taskType"),
                "eligibleCount": _as_int(value.get("eligibleCount")),
                "acceptedCount": _as_int(value.get("acceptedCount")),
                "reusedCount": _as_int(value.get("reusedCount")),
                "skippedCount": _as_int(value.get("skippedCount")),
            }
        )
        batch["tasks"] = tasks
        return batch

    def _entity_payload(
        self,
        args: argparse.Namespace,
        *,
        field_name: str,
        attribute_name: str,
    ) -> dict[str, Any]:
        return _compact(
            {
                "resourceId": self._resource_id(args),
                "filePath": args.file_path.strip() if args.file_path else None,
                field_name: getattr(args, attribute_name),
                "force": args.force,
                "extraParams": args.extra_params_json,
            }
        )

    def _entity_discovery(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = self._entity_payload(
            args,
            field_name="maxEntities",
            attribute_name="max_entities",
        )
        session_id = _normalize_session_id(args.session_id)
        if args.dry_run:
            result = {
                "ok": True,
                "action": "entity-discovery",
                "dryRun": True,
                "payload": payload,
            }
            if session_id:
                result["headers"] = {SESSION_ID_HEADER: session_id}
            return result
        value = self.api.entity_discovery(
            payload,
            session_id=session_id,
        )
        return {
            "ok": True,
            "action": "entity-discovery",
            "accepted": True,
            "batch": self._entity_batch(value, resource_id=payload["resourceId"]),
        }

    def _entity_enrich(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = self._entity_payload(
            args,
            field_name="topK",
            attribute_name="top_k",
        )
        session_id = _normalize_session_id(args.session_id)
        if args.dry_run:
            result = {
                "ok": True,
                "action": "entity-enrich",
                "dryRun": True,
                "payload": payload,
            }
            if session_id:
                result["headers"] = {SESSION_ID_HEADER: session_id}
            return result
        value = self.api.entity_enrich(
            payload,
            session_id=session_id,
        )
        return {
            "ok": True,
            "action": "entity-enrich",
            "accepted": True,
            "batch": self._entity_batch(value, resource_id=payload["resourceId"]),
        }

    def _remove_file(self, args: argparse.Namespace) -> dict[str, Any]:
        payload = self._file_path_payload(self._resource_id(args), args.file_path)
        if args.dry_run:
            return {"ok": True, "action": "remove-file", "dryRun": True, "payload": payload}
        return {"ok": True, "action": "remove-file", "removed": self.api.remove_file(payload)}


def _add_single_resource(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--resource-id",
        type=_positive_int,
        required=True,
        metavar="ID",
        help="知识库资源 ID（正整数）",
    )


def _add_dry_run(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只校验参数并输出计划，不调用变更接口",
    )


def _add_command(
    subparsers: Any,
    name: str,
    description: str,
) -> argparse.ArgumentParser:
    command = subparsers.add_parser(
        name,
        help=description,
        description=description,
    )
    if name in SESSION_AWARE_COMMANDS:
        command.add_argument(
            "--session-id",
            default="",
            metavar="ID",
            help=(
                "当前任务会话 ID；显式传入时优先使用，"
                "未提供时尝试使用运行环境中的当前会话"
            ),
        )
    return command


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="by-knowledge-manager",
        description="管理 ByClaw 知识库目录、文件、构建、实体处理任务和检索。",
        epilog=(
            "示例：\n"
            "  by-knowledge-manager list --resource-id 1001 --directory-path /\n"
            "  by-knowledge-manager upload --resource-id 1001 --directory-path /docs "
            "--file-path ./manual.pdf\n"
            "  by-knowledge-manager entity-discovery --resource-id 1001 "
            "--file-path /docs/manual.md\n"
            "  by-knowledge-manager search --resource-id 1001 --query '退款规则'\n\n"
            "查看子命令参数：by-knowledge-manager <command> --help"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(
        dest="command",
        required=True,
        title="命令",
        metavar="COMMAND",
    )

    descriptions = {
        "mkdir": "创建知识库目录",
        "rename-dir": "重命名知识库目录",
        "delete-dir": "删除知识库目录",
        "list": "列出指定目录的文件和子目录",
        "check-conflicts": "上传前检查目标目录中的同名文件",
        "upload": "导入一个或多个文件或 ZIP，并自动触发构建",
        "update-file": "更新一个已有文件，并自动触发构建",
        "build": "触发指定知识文件构建",
        "build-status": "查询知识文件构建状态",
        "download": "下载知识库文件或目录压缩包",
        "read-file": "按行读取知识库文件内容",
        "search": "检索知识库内容切片",
        "search-file": "检索知识库相关文件",
        "entity-discovery": "异步发现原始文档中的知识实体",
        "entity-enrich": "异步补全 KnowledgeEntity 文档",
        "remove-file": "删除知识库文件",
    }

    for name in ("mkdir", "rename-dir"):
        command = _add_command(subparsers, name, descriptions[name])
        _add_single_resource(command)
        command.add_argument(
            "--directory-path",
            required=True,
            metavar="PATH",
            help="目标目录的绝对路径，例如 / 或 /产品资料",
        )
        command.add_argument(
            "--directory-name",
            required=True,
            metavar="NAME",
            help="要创建的新目录名或重命名后的目录名",
        )
        if name == "mkdir":
            command.add_argument(
                "--directory-description",
                metavar="TEXT",
                help="目录说明",
            )
        _add_dry_run(command)

    for name in ("delete-dir", "list"):
        command = _add_command(subparsers, name, descriptions[name])
        _add_single_resource(command)
        command.add_argument(
            "--directory-path",
            required=True,
            metavar="PATH",
            help="知识库目录的绝对路径",
        )
        if name == "delete-dir":
            _add_dry_run(command)

    conflicts = _add_command(
        subparsers,
        "check-conflicts",
        descriptions["check-conflicts"],
    )
    _add_single_resource(conflicts)
    conflicts.add_argument(
        "--directory-path",
        required=True,
        metavar="PATH",
        help="准备上传到的知识库目录",
    )
    conflicts.add_argument(
        "--file-name",
        action="append",
        required=True,
        metavar="NAME",
        help="待检查的文件名；检查多个文件时重复传入",
    )
    _add_dry_run(conflicts)

    for name in ("upload", "update-file"):
        command = _add_command(subparsers, name, descriptions[name])
        _add_single_resource(command)
        command.add_argument(
            "--directory-path",
            required=True,
            metavar="PATH",
            help="目标知识库目录",
        )
        command.add_argument(
            "--file-path",
            action="append",
            required=True,
            metavar="LOCAL_FILE",
            help=(
                "本地文件路径；upload 可重复传入或上传 ZIP，"
                "update-file 只能传一个文件"
            ),
        )
        command.add_argument(
            "--file-description",
            metavar="TEXT",
            help="文件说明",
        )
        command.add_argument(
            "--process-front-matter",
            type=_boolean,
            default=True,
            metavar="BOOL",
            help="是否解析 Markdown front matter，可选 true/false（默认 true）",
        )
        if name == "upload":
            command.add_argument(
                "--skip-if-duplicate",
                action="store_true",
                help="跳过内容重复的文件",
            )
            command.add_argument(
                "--check-conflicts",
                action="store_true",
                help="上传前检查同名文件；存在冲突时不上传",
            )
        _add_dry_run(command)

    for name in ("build", "build-status", "remove-file"):
        command = _add_command(subparsers, name, descriptions[name])
        _add_single_resource(command)
        command.add_argument(
            "--file-path",
            required=True,
            metavar="PATH",
            help="知识库文件的绝对路径",
        )
        if name != "build-status":
            _add_dry_run(command)

    download = _add_command(subparsers, "download", descriptions["download"])
    _add_single_resource(download)
    target = download.add_mutually_exclusive_group(required=True)
    target.add_argument(
        "--file-path",
        metavar="PATH",
        help="要下载的知识库文件绝对路径",
    )
    target.add_argument(
        "--directory-path",
        metavar="PATH",
        help="要打包下载的知识库目录绝对路径",
    )
    download.add_argument(
        "--output",
        required=True,
        metavar="LOCAL_PATH",
        help="本地输出文件路径",
    )
    _add_dry_run(download)

    read = _add_command(subparsers, "read-file", descriptions["read-file"])
    _add_single_resource(read)
    read.add_argument(
        "--file-path",
        required=True,
        metavar="PATH",
        help="知识库文件的绝对路径",
    )
    read.add_argument(
        "--start-line",
        type=_positive_int,
        metavar="N",
        help="起始行号（从 1 开始）",
    )
    read.add_argument(
        "--end-line",
        type=_positive_int,
        metavar="N",
        help="结束行号（包含该行）",
    )

    for name in ("search", "search-file"):
        command = _add_command(subparsers, name, descriptions[name])
        command.add_argument(
            "--resource-id",
            action="append",
            type=_positive_int,
            required=True,
            metavar="ID",
            help="知识库资源 ID；检索多个知识库时重复传入",
        )
        command.add_argument(
            "--query",
            required=True,
            metavar="TEXT",
            help="自然语言检索词",
        )
        command.add_argument(
            "--top-k",
            type=_positive_int,
            default=5,
            metavar="N",
            help="返回结果数量（默认 5）",
        )
        command.add_argument(
            "--where-json",
            type=_agent_dsl,
            metavar="JSON",
            help="Agent DSL 的 where JSON 对象；完整规则见检索子 Skill",
        )
        command.add_argument(
            "--metadata-field",
            action="append",
            metavar="NAME",
            help="需要返回的元数据字段；多个字段时重复传入",
        )
        command.add_argument(
            "--search-mode",
            choices=("fullTextRecall", "embedding", "mixedRecall"),
            default="mixedRecall",
            help="检索召回模式（默认 mixedRecall）",
        )

    for name in ("entity-discovery", "entity-enrich"):
        command = _add_command(subparsers, name, descriptions[name])
        _add_single_resource(command)
        command.add_argument(
            "--file-path",
            metavar="PATH",
            help=(
                "知识库内文件路径；不传或传空白时处理整个知识库。"
                + (
                    "文件必须位于 /KnowledgeEntity"
                    if name == "entity-enrich"
                    else "文件必须是支持实体发现的原始文档"
                )
            ),
        )
        if name == "entity-discovery":
            command.add_argument(
                "--max-entities",
                type=_integer_range(1, 12),
                default=12,
                metavar="N",
                help="单个文档最多发现的实体数，范围 1-12（默认 12）",
            )
        else:
            command.add_argument(
                "--top-k",
                type=_integer_range(1, 100),
                default=20,
                metavar="N",
                help="语义证据候选数量，范围 1-100（默认 20）",
            )
        command.add_argument(
            "--force",
            action="store_true",
            help="绕过新鲜成功结果的复用并重新处理",
        )
        command.add_argument(
            "--extra-params-json",
            type=_json_object,
            default={},
            metavar="JSON",
            help="随异步任务保存的 JSON 对象",
        )
        _add_dry_run(command)

    return parser


def _boolean(value: str) -> bool:
    normalized = value.lower()
    if normalized in {"true", "1", "yes"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    raise argparse.ArgumentTypeError("必须是 true 或 false")


def _positive_int(value: str) -> int:
    try:
        number = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("必须是正整数") from exc
    if number <= 0:
        raise argparse.ArgumentTypeError("必须是正整数")
    return number


def _integer_range(minimum: int, maximum: int) -> Any:
    def parse(value: str) -> int:
        try:
            number = int(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(
                f"必须是 {minimum}-{maximum} 之间的整数"
            ) from exc
        if not minimum <= number <= maximum:
            raise argparse.ArgumentTypeError(
                f"必须是 {minimum}-{maximum} 之间的整数"
            )
        return number

    return parse


def _json_object(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise argparse.ArgumentTypeError(f"不是合法 JSON: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise argparse.ArgumentTypeError("必须是 JSON 对象")
    return parsed


def _agent_dsl(value: str) -> dict[str, Any]:
    expression = _json_object(value)
    boolean_operators = {"and", "or", "not"}
    leaf_operators = {
        "eq",
        "ne",
        "in",
        "contains",
        "exists",
        "gt",
        "gte",
        "lt",
        "lte",
        "prefix",
        "wildcard",
    }
    leaf_count = 0

    def visit(node: Any, *, boolean_depth: int, path: str) -> None:
        nonlocal leaf_count
        if not isinstance(node, dict) or len(node) != 1:
            raise argparse.ArgumentTypeError(
                f"{path} 必须是只包含一个操作符的对象"
            )
        operator, operand = next(iter(node.items()))
        if operator not in boolean_operators | leaf_operators:
            raise argparse.ArgumentTypeError(f"{path} 使用了不支持的操作符: {operator}")

        if operator in boolean_operators:
            next_depth = boolean_depth + 1
            if next_depth > 3:
                raise argparse.ArgumentTypeError("where 布尔嵌套深度不能超过 3")
            if operator in {"and", "or"}:
                if not isinstance(operand, list) or not operand:
                    raise argparse.ArgumentTypeError(
                        f"{path}.{operator} 必须是非空数组"
                    )
                for index, child in enumerate(operand):
                    visit(
                        child,
                        boolean_depth=next_depth,
                        path=f"{path}.{operator}[{index}]",
                    )
            else:
                if not isinstance(operand, dict):
                    raise argparse.ArgumentTypeError(
                        f"{path}.not 必须是单个表达式对象"
                    )
                visit(operand, boolean_depth=next_depth, path=f"{path}.not")
            return

        leaf_count += 1
        if leaf_count > 12:
            raise argparse.ArgumentTypeError("where 叶子条件数不能超过 12")
        if not isinstance(operand, dict):
            raise argparse.ArgumentTypeError(f"{path}.{operator} 必须是对象")
        field_name = operand.get("fieldName")
        if not isinstance(field_name, str) or not field_name.strip():
            raise argparse.ArgumentTypeError(
                f"{path}.{operator}.fieldName 必须是非空字符串"
            )
        allowed_keys = {"fieldName", "value"}
        unknown_keys = set(operand) - allowed_keys
        if unknown_keys:
            raise argparse.ArgumentTypeError(
                f"{path}.{operator} 包含未知字段: {', '.join(sorted(unknown_keys))}"
            )
        if operator == "exists":
            if "value" in operand:
                raise argparse.ArgumentTypeError("exists 不应携带 value")
            return
        if "value" not in operand:
            raise argparse.ArgumentTypeError(f"{path}.{operator} 缺少 value")
        leaf_value = operand["value"]
        if operator == "in" and (
            not isinstance(leaf_value, list) or not leaf_value
        ):
            raise argparse.ArgumentTypeError("in.value 必须是非空数组")
        if operator in {"contains", "prefix", "wildcard"} and not isinstance(
            leaf_value, str
        ):
            raise argparse.ArgumentTypeError(f"{operator}.value 必须是字符串")
        scalar_types = (str, int, float, bool)
        if operator in {"eq", "ne"} and not isinstance(leaf_value, scalar_types):
            raise argparse.ArgumentTypeError(f"{operator}.value 必须是标量")
        if operator in {"gt", "gte", "lt", "lte"} and (
            isinstance(leaf_value, bool)
            or not isinstance(leaf_value, (str, int, float))
        ):
            raise argparse.ArgumentTypeError(
                f"{operator}.value 必须是数值或 ISO 8601 字符串"
            )
        if operator == "in" and any(
            not isinstance(item, scalar_types) for item in leaf_value
        ):
            raise argparse.ArgumentTypeError("in.value 的元素必须是标量")

    visit(expression, boolean_depth=0, path="where")
    return expression


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else os.sys.argv[1:])
    parser = build_parser()
    if not argv:
        parser.print_help()
        return 0
    args = parser.parse_args(argv)
    transport: ManagerTransport | None = None
    try:
        transport = ByFrameworkDiscoveryTransport(
            session_id=getattr(args, "session_id", ""),
            supports_session=args.command in SESSION_AWARE_COMMANDS,
        )
        result = KnowledgeManager(BackendApi(transport)).execute(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    finally:
        if transport is not None:
            transport.close()


if __name__ == "__main__":
    raise SystemExit(main())
