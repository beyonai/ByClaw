from __future__ import annotations

import os
import sys
import types
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch


PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR / "src"))

from kbcli.errors import KbCliError  # noqa: E402
from kbcli.service_client import ServiceClient  # noqa: E402


class _AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *_args):
        return None


class ServiceDiscoveryTests(unittest.TestCase):
    def test_validation_failure_disguised_as_http_500_is_not_retryable(self):
        response = types.SimpleNamespace(
            is_success=False,
            status_code=500,
            data={"code": -1, "msg": "检索知识库内容失败：request validation failed"},
        )

        with self.assertRaises(KbCliError) as captured:
            ServiceClient._normalize(response)

        self.assertEqual("INVALID_ARGUMENT", captured.exception.code)
        self.assertFalse(captured.exception.retryable)

    def test_invalid_file_path_disguised_as_http_500_is_not_retryable(self):
        response = types.SimpleNamespace(
            is_success=False,
            status_code=500,
            data={"code": -1, "msg": "知识库文件路径不合法"},
        )

        with self.assertRaises(KbCliError) as captured:
            ServiceClient._normalize(response)

        self.assertEqual("INVALID_ARGUMENT", captured.exception.code)
        self.assertFalse(captured.exception.retryable)

    def framework_modules(self):
        calls = {}

        class RedisConfig:
            def __init__(self, **kwargs):
                calls["redis"] = kwargs

        def init_redis(*, config):
            calls["initialized"] = config

        class DiscoveryClient:
            def __init__(self, *, cache_interval):
                calls["cache_interval"] = cache_interval

            async def close(self):
                calls["closed"] = True

        class RetryConfig:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            @classmethod
            def no_retry(cls):
                return cls(max_attempts=1)

        class ByHttpClient:
            def __init__(self, *_args, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

        response = types.SimpleNamespace(
            is_success=True, status_code=200,
            data={"code": 0, "msg": "ok", "data": {"resourceId": "9"}},
            content=b"",
            headers={},
        )

        class HttpClient:
            async def post(self, service, path, **kwargs):
                calls["post"] = (service, path, kwargs)
                return response

            async def upload_multiple(self, service, path, file_paths, *, file_field="file",
                                      headers=None, form_fields=None):
                calls["upload_multiple"] = (
                    service, path, list(file_paths),
                    {"file_field": file_field, "headers": headers, "form_fields": form_fields},
                )
                if path.endswith("/fileToMarkdown"):
                    return types.SimpleNamespace(
                        is_success=True, status_code=200, data="# converted",
                        content=None, headers={"content-type": "text/markdown; charset=UTF-8"},
                    )
                return response

            async def get(self, service, path, *, headers=None, params=None):
                calls["get"] = (service, path, {"headers": headers, "params": params})
                return types.SimpleNamespace(
                    is_success=True, status_code=200, data="知识库构建任务已提交",
                    content=None, headers={"content-type": "text/plain; charset=UTF-8"},
                )

            async def download(self, service, path, destination, *, headers=None, params=None):
                calls["download"] = (
                    service, path, Path(destination), {"headers": headers, "params": params},
                )
                Path(destination).write_bytes(calls.get("download_content", b"PK\x03\x04xlsx-binary"))
                return types.SimpleNamespace(
                    is_success=True, status_code=200, data=str(destination),
                    headers={"content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
                )

        def discovery_http_client(*_args, **_kwargs):
            return _AsyncContext(HttpClient())

        modules = {
            "by_framework": types.ModuleType("by_framework"),
            "by_framework.common": types.ModuleType("by_framework.common"),
            "by_framework.common.config": types.ModuleType("by_framework.common.config"),
            "by_framework.common.redis_client": types.ModuleType("by_framework.common.redis_client"),
            "by_framework.core": types.ModuleType("by_framework.core"),
            "by_framework.core.discovery": types.ModuleType("by_framework.core.discovery"),
            "by_framework.util": types.ModuleType("by_framework.util"),
            "by_framework.util.discovery_http_client": types.ModuleType("by_framework.util.discovery_http_client"),
            "by_framework.util.http_client": types.ModuleType("by_framework.util.http_client"),
        }
        modules["by_framework.common.config"].RedisConfig = RedisConfig
        modules["by_framework.common.redis_client"].init_redis = init_redis
        modules["by_framework.core.discovery"].DiscoveryClient = DiscoveryClient
        modules["by_framework.util.discovery_http_client"].DiscoveryHttpClient = discovery_http_client
        modules["by_framework.util.http_client"].ByHttpClient = ByHttpClient
        modules["by_framework.util.http_client"].RetryConfig = RetryConfig
        return modules, calls

    def test_json_request_uses_framework_service_discovery_and_runtime_auth(self):
        modules, calls = self.framework_modules()
        env = {
            "KBCLI_KNOWLEDGE_SERVICE": "ByaiService",
            "BEYOND_TOKEN": "secret",
            "SYSTEM_CODE": "BYCLAW",
            "REDIS_HOST": "redis",
        }
        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, modules))
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            result = ServiceClient().json(
                "POST", "/byaiService/datasetController/readFile",
                session_id="session-1", payload={"resourceId": "9", "filePath": "/a.md"},
            )
        self.assertEqual("9", result["data"]["resourceId"])
        service, path, kwargs = calls["post"]
        self.assertEqual("ByaiService", service)
        self.assertEqual("/byaiService/datasetController/readFile", path)
        self.assertEqual("secret", kwargs["headers"]["Beyond-Token"])
        self.assertEqual("session-1", kwargs["headers"]["x-session-id"])
        self.assertEqual("BYCLAW", kwargs["headers"]["system-code"])
        self.assertNotIn("endpoint", kwargs)

    def test_multipart_uses_discovery_upload_api_instead_of_post_files_argument(self):
        modules, calls = self.framework_modules()
        env = {"KBCLI_KNOWLEDGE_SERVICE": "ByaiService"}
        upload_path = PROJECT_DIR / "tests" / "upload-sample.txt"
        upload_path.write_text("sample", encoding="utf-8")
        self.addCleanup(upload_path.unlink, missing_ok=True)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, modules))
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            result = ServiceClient().multipart(
                "/byaiService/datasetController/uploadFiles",
                session_id="session-1",
                fields={"resourceId": "9", "directoryPath": "/"},
                files=[upload_path],
            )

        self.assertEqual("9", result["data"]["resourceId"])
        service, path, files, kwargs = calls["upload_multiple"]
        self.assertEqual("ByaiService", service)
        self.assertEqual("/byaiService/datasetController/uploadFiles", path)
        self.assertEqual([upload_path], files)
        self.assertEqual("files", kwargs["file_field"])
        self.assertEqual({"resourceId": "9", "directoryPath": "/"}, kwargs["form_fields"])
        self.assertEqual("session-1", kwargs["headers"]["x-session-id"])
        self.assertNotIn("post", calls)

    def test_multipart_download_writes_non_json_response_atomically(self):
        modules, calls = self.framework_modules()
        env = {"KBCLI_KNOWLEDGE_SERVICE": "ByaiService"}
        source = PROJECT_DIR / "tests" / "convert-source.xls"
        output = PROJECT_DIR / "tests" / "convert-output.md"
        source.write_bytes(b"source")
        self.addCleanup(source.unlink, missing_ok=True)
        self.addCleanup(output.unlink, missing_ok=True)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, modules))
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            result = ServiceClient().multipart_download(
                "/byaiService/datasetController/fileToMarkdown",
                session_id="session-1", file=source, file_field="fileContent", output=output,
            )

        self.assertEqual("fileContent", calls["upload_multiple"][3]["file_field"])
        self.assertEqual(b"# converted", output.read_bytes())
        self.assertEqual(output.resolve(), Path(result["outputPath"]))

    def test_text_get_returns_plain_text_through_service_discovery(self):
        modules, calls = self.framework_modules()
        env = {"KBCLI_KNOWLEDGE_SERVICE": "ByaiService"}
        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, modules))
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            result = ServiceClient().text(
                "GET", "/byaiService/datasetController/buildKnowledgeFromDoc",
                session_id="session-1", query={"resourceId": "9", "doc": "# doc"},
            )
        self.assertEqual("知识库构建任务已提交", result)
        self.assertEqual("ByaiService", calls["get"][0])

    def test_download_streams_binary_through_discovery_download_api(self):
        modules, calls = self.framework_modules()
        env = {"KBCLI_KNOWLEDGE_SERVICE": "ByaiService"}
        output = PROJECT_DIR / "tests" / "download-result.xlsx"
        self.addCleanup(output.unlink, missing_ok=True)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, modules))
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            result = ServiceClient().download(
                "/byaiService/datasetController/download", session_id="session-1",
                query={"resourceId": "9", "directoryPath": "/docs/report.xlsx"}, output=output,
            )

        self.assertEqual(b"PK\x03\x04xlsx-binary", output.read_bytes())
        self.assertEqual(len(b"PK\x03\x04xlsx-binary"), result["size"])
        self.assertEqual("ByaiService", calls["download"][0])
        self.assertNotIn("get", calls)

    def test_download_rejects_empty_remote_file_and_leaves_no_output(self):
        modules, calls = self.framework_modules()
        calls["download_content"] = b""
        env = {"KBCLI_KNOWLEDGE_SERVICE": "ByaiService"}
        output = PROJECT_DIR / "tests" / "empty-download.xlsx"
        self.addCleanup(output.unlink, missing_ok=True)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, modules))
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            with self.assertRaises(KbCliError) as captured:
                ServiceClient().download(
                    "/byaiService/datasetController/download", session_id="session-1",
                    query={"resourceId": "9", "directoryPath": "/docs/report.xlsx"}, output=output,
                )

        self.assertEqual("EMPTY_DOWNLOAD", captured.exception.code)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
