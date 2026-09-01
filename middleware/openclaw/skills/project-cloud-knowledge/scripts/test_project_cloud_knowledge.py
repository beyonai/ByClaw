#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import io
import os
import sys
import tempfile
import types
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("project_cloud_knowledge.py")
SPEC = importlib.util.spec_from_file_location("project_cloud_knowledge", SCRIPT)
assert SPEC and SPEC.loader
manager_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manager_module)


class RecordingTransport:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.responses: list[object] = []

    def request(self, **kwargs: object) -> object:
        self.calls.append({"kind": "request", **kwargs})
        return self.responses.pop(0) if self.responses else None

    def upload(self, **kwargs: object) -> object:
        self.calls.append({"kind": "upload", **kwargs})
        return self.responses.pop(0) if self.responses else None

    def download(self, **kwargs: object) -> dict[str, object]:
        self.calls.append({"kind": "download", **kwargs})
        return self.responses.pop(0) if self.responses else {}

    def close(self) -> None:
        return None


class RedisConfigTests(unittest.TestCase):
    def load(self, environment: dict[str, str]) -> dict[str, object]:
        with patch.dict(os.environ, environment, clear=True):
            return manager_module._redis_config_from_env(dict)

    def test_cluster_and_standalone_configuration(self) -> None:
        cluster = self.load({"REDIS_CLUSTER_HOST": "redis-1:6371,redis-2:6372"})
        self.assertEqual(cluster["mode"], "cluster")
        self.assertEqual(cluster["cluster_nodes"], [("redis-1", 6371), ("redis-2", 6372)])
        standalone = self.load({"REDIS_HOST": "redis", "REDIS_PORT": "6380", "REDIS_DATABASE": "2"})
        self.assertEqual((standalone["mode"], standalone["host"], standalone["port"], standalone["db"]), ("standalone", "redis", 6380, 2))


class RequestHeaderTests(unittest.TestCase):
    def test_runtime_scopes_optional_chat_session_to_supported_commands(self) -> None:
        class FakeRedis:
            async def get(self, key: str) -> str:
                self.assert_key = key
                return "user-7"

            async def hget(self, key: str, field: str) -> str:
                self.assert_hash = (key, field)
                return "token"

        class FakeDiscoveryClient:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        config_module = types.ModuleType("by_framework.common.config")
        config_module.RedisConfig = dict
        redis_module = types.ModuleType("by_framework.common.redis_client")
        redis_module.init_redis = lambda **kwargs: FakeRedis()
        discovery_module = types.ModuleType("by_framework.core.discovery")
        discovery_module.DiscoveryClient = FakeDiscoveryClient
        modules = {
            "by_framework": types.ModuleType("by_framework"),
            "by_framework.common": types.ModuleType("by_framework.common"),
            "by_framework.common.config": config_module,
            "by_framework.common.redis_client": redis_module,
            "by_framework.core": types.ModuleType("by_framework.core"),
            "by_framework.core.discovery": discovery_module,
        }
        transport = manager_module.ByFrameworkDiscoveryTransport.__new__(
            manager_module.ByFrameworkDiscoveryTransport
        )
        transport._supports_session = True

        with (
            patch.dict(sys.modules, modules),
            patch.dict(
                os.environ,
                {
                    "BE_DOMAINNAME": "byclaw-be",
                    "USER_CODE": "user-code",
                    "SESSION_ID": "session-001",
                },
                clear=True,
            ),
        ):
            _, _, headers = manager_module.asyncio.run(transport._runtime())

        self.assertEqual(
            headers,
            {
                "Beyond-Token": "token",
                "X-User-Code": "user-code",
            },
        )

        explicit_session_transport = (
            manager_module.ByFrameworkDiscoveryTransport.__new__(
                manager_module.ByFrameworkDiscoveryTransport
            )
        )
        explicit_session_transport._supports_session = True
        explicit_session_transport._session_id = "chat-session-001"
        with (
            patch.dict(sys.modules, modules),
            patch.dict(
                os.environ,
                {
                    "BE_DOMAINNAME": "byclaw-be",
                    "USER_CODE": "user-code",
                    "SESSION_ID": "login-session-001",
                },
                clear=True,
            ),
        ):
            _, _, explicit_session_headers = manager_module.asyncio.run(
                explicit_session_transport._runtime()
            )
        self.assertEqual(
            explicit_session_headers,
            {
                "Beyond-Token": "token",
                "X-User-Code": "user-code",
                "X-CHAT-SESSION-ID": "chat-session-001",
            },
        )

        read_transport = manager_module.ByFrameworkDiscoveryTransport.__new__(
            manager_module.ByFrameworkDiscoveryTransport
        )
        read_transport._supports_session = False
        with (
            patch.dict(sys.modules, modules),
            patch.dict(
                os.environ,
                {"BE_DOMAINNAME": "byclaw-be", "USER_CODE": "user-code"},
                clear=True,
            ),
        ):
            _, _, read_headers = manager_module.asyncio.run(
                read_transport._runtime()
            )
        self.assertEqual(
            read_headers,
            {"Beyond-Token": "token", "X-User-Code": "user-code"},
        )

        write_without_session = (
            manager_module.ByFrameworkDiscoveryTransport.__new__(
                manager_module.ByFrameworkDiscoveryTransport
            )
        )
        write_without_session._supports_session = True
        with (
            patch.dict(sys.modules, modules),
            patch.dict(
                os.environ,
                {"BE_DOMAINNAME": "byclaw-be", "USER_CODE": "user-code"},
                clear=True,
            ),
        ):
            _, _, write_headers = manager_module.asyncio.run(
                write_without_session._runtime()
            )
        self.assertEqual(
            write_headers,
            {"Beyond-Token": "token", "X-User-Code": "user-code"},
        )

    def test_single_resource_requests_include_resource_header(self) -> None:
        for values in (
            {"payload": {"resourceId": 7}},
            {"params": {"resourceId": 7}},
            {"form_fields": {"resourceId": "7"}},
            {"payload": {"resourceIdList": [7]}},
        ):
            with self.subTest(values=values):
                resource_id = manager_module._request_resource_id(**values)
                headers = manager_module._request_headers(
                    {"Beyond-Token": "token", "X-User-Code": "user"},
                    resource_id=resource_id,
                    json_content="payload" in values,
                )
                self.assertEqual(headers["X-BYCLAW-RESOURCE-ID"], "7")

    def test_multi_resource_search_omits_single_resource_header(self) -> None:
        resource_id = manager_module._request_resource_id(
            payload={"resourceIdList": [7, 8]}
        )
        headers = manager_module._request_headers(
            {"Beyond-Token": "token", "X-User-Code": "user"},
            resource_id=resource_id,
            json_content=True,
        )
        self.assertNotIn("X-BYCLAW-RESOURCE-ID", headers)
        self.assertEqual(headers["Content-Type"], "application/json")


class BackendApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.transport = RecordingTransport()
        self.api = manager_module.BackendApi(self.transport)

    def test_backend_paths_and_payloads(self) -> None:
        self.api.create_directory({"resourceId": 1})
        self.api.rename_directory({"resourceId": 1})
        self.api.delete_directory({"resourceId": 1})
        self.api.list_directory({"resourceId": 1})
        self.api.check_conflicts({"resourceId": 1})
        self.api.build({"resourceId": 1})
        self.api.read_file({"resourceId": 1})
        self.api.search({"resourceIdList": [1]})
        self.api.search_file({"resourceIdList": [1]})
        self.api.metadata_search({"resourceIdList": [1]})
        self.api.entity_discovery({"resourceId": 1})
        self.api.entity_enrich({"resourceId": 1})
        self.api.remove_file({"resourceId": 1})
        paths = [call["path"] for call in self.transport.calls]
        self.assertEqual(paths, [
            "/byaiService/datasetController/createFolder",
            "/byaiService/datasetController/renameFolder",
            "/byaiService/datasetController/deleteFolder",
            "/byaiService/datasetController/queryDirAndFileByLevel",
            "/byaiService/datasetController/checkUploadFileConflicts",
            "/byaiService/datasetController/build",
            "/byaiService/datasetController/readFile",
            "/byaiService/datasetController/knowledgeItems/search",
            "/byaiService/datasetController/knowledgeItems/searchFile",
            "/byaiService/datasetController/knowledgeItems/metadataSearch",
            "/byaiService/datasetController/knowledgeItems/entityDiscovery",
            "/byaiService/datasetController/knowledgeItems/entityEnrich",
            "/byaiService/datasetController/removeFile",
        ])

    def test_build_status_and_download_use_backend_get_contract(self) -> None:
        self.api.build_status(resource_id=7, file_path="/docs/a.md")
        self.api.download(resource_id=7, target_path="/docs/", output=Path("/tmp/docs.zip"))
        self.assertEqual(self.transport.calls[0], {
            "kind": "request", "method": "GET",
            "path": "/byaiService/datasetController/fileBuildStatus",
            "params": {"resourceId": 7, "directoryPath": "/docs/a.md"},
        })
        self.assertEqual(self.transport.calls[1]["params"], {"resourceId": 7, "directoryPath": "/docs/"})

    def test_update_uses_dedicated_backend_interface(self) -> None:
        self.api.update_file(file=Path("a.md"), form_fields={"resourceId": "7"})
        self.assertEqual(self.transport.calls[0]["path"], "/byaiService/datasetController/knowledgeItems/update")
        self.assertEqual(self.transport.calls[0]["file_paths"], [Path("a.md")])
        self.assertEqual(self.transport.calls[0]["file_field"], "fileContent")

    def test_transport_preserves_dsl_error_details(self) -> None:
        with self.assertRaisesRegex(ValueError, "UNKNOWN_FIELD"):
            manager_module.ByFrameworkDiscoveryTransport._unwrap_body(
                {
                    "code": -1,
                    "msg": "request validation failed",
                    "data": {
                        "errorCode": "DSL_VALIDATION_ERROR",
                        "errorList": [
                            {
                                "path": "where.eq.fieldName",
                                "code": "UNKNOWN_FIELD",
                                "message": "unknown field",
                            }
                        ],
                    },
                },
                "/knowledgeItems/search",
            )


class KnowledgeManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.transport = RecordingTransport()
        self.manager = manager_module.KnowledgeManager(manager_module.BackendApi(self.transport))
        self.temp_dir = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def parse(self, *argv: str):
        return manager_module.build_parser().parse_args(argv)

    def make_file(self, name: str = "a.md") -> Path:
        file = Path(self.temp_dir.name) / name
        file.write_text("# A\n", encoding="utf-8")
        return file

    def make_zip(self, name: str, entries: dict[str, str]) -> Path:
        archive = Path(self.temp_dir.name) / name
        with zipfile.ZipFile(archive, "w") as output:
            for path, content in entries.items():
                output.writestr(path, content)
        return archive

    def test_writes_reject_reserved_knowledge_entity_targets_before_network(self) -> None:
        file = self.make_file("entity.md")
        commands = (
            (
                "mkdir",
                "--resource-id",
                "7",
                "--directory-path",
                "/",
                "--directory-name",
                "KnowledgeEntity",
                "--dry-run",
            ),
            (
                "mkdir",
                "--resource-id",
                "7",
                "--directory-path",
                "/KnowledgeEntity",
                "--directory-name",
                "子目录",
                "--dry-run",
            ),
            (
                "rename-dir",
                "--resource-id",
                "7",
                "--directory-path",
                "/docs",
                "--directory-name",
                "KnowledgeEntity",
                "--dry-run",
            ),
            (
                "upload",
                "--resource-id",
                "7",
                "--directory-path",
                "/KnowledgeEntity",
                "--file-path",
                str(file),
                "--dry-run",
            ),
            (
                "check-conflicts",
                "--resource-id",
                "7",
                "--directory-path",
                "/KnowledgeEntity",
                "--file-name",
                "entity.md",
                "--dry-run",
            ),
            (
                "update-file",
                "--resource-id",
                "7",
                "--directory-path",
                "/KnowledgeEntity",
                "--file-path",
                str(file),
                "--dry-run",
            ),
        )
        for argv in commands:
            with self.subTest(command=argv[0]), self.assertRaisesRegex(
                ValueError,
                "只允许保存系统整理生成的知识实体文件",
            ):
                self.manager.execute(self.parse(*argv))
        self.assertEqual(self.transport.calls, [])

    def test_zip_upload_rejects_indirect_knowledge_entity_entries(self) -> None:
        archive = self.make_zip(
            "batch.zip",
            {
                "docs/a.md": "# A\n",
                "KnowledgeEntity/manual.md": "# manual\n",
            },
        )
        with self.assertRaisesRegex(ValueError, "禁止将目录或文件保存"):
            self.manager.execute(
                self.parse(
                    "upload",
                    "--resource-id",
                    "7",
                    "--directory-path",
                    "/",
                    "--file-path",
                    str(archive),
                    "--dry-run",
                )
            )
        self.assertEqual(self.transport.calls, [])

    def test_similarly_named_nested_directory_remains_writable(self) -> None:
        result = self.manager.execute(
            self.parse(
                "mkdir",
                "--resource-id",
                "7",
                "--directory-path",
                "/docs",
                "--directory-name",
                "KnowledgeEntity",
                "--dry-run",
            )
        )
        self.assertTrue(result["dryRun"])

    def test_upload_allows_zip_and_builds_returned_items(self) -> None:
        archive = self.make_file("batch.zip")
        self.transport.responses = [
            {"resourceId": 7, "uploadItems": [{"fileName": "a.md", "filePath": "/docs/a.md"}]},
            None,
        ]
        result = self.manager.execute(self.parse("upload", "--resource-id", "7", "--directory-path", "/docs", "--file-path", str(archive)))
        self.assertEqual(result["builds"], [{"filePath": "/docs/a.md", "built": None}])
        self.assertEqual(self.transport.calls[0]["form_fields"]["overwrite"], "false")
        self.assertEqual(self.transport.calls[0]["file_field"], "files")
        self.assertEqual(self.transport.calls[0]["file_paths"], [archive.resolve()])

    def test_update_calls_dedicated_update_then_build(self) -> None:
        file = self.make_file()
        self.transport.responses = [{"data": [{"filePath": "/docs/a.md"}]}, None]
        result = self.manager.execute(self.parse("update-file", "--resource-id", "7", "--directory-path", "/docs", "--file-path", str(file)))
        self.assertEqual(result["builds"], [{"filePath": "/docs/a.md", "built": None}])
        self.assertEqual(self.transport.calls[0]["path"], "/byaiService/datasetController/knowledgeItems/update")
        self.assertEqual(self.transport.calls[0]["form_fields"]["filePath"], "/docs/a.md")
        self.assertEqual(self.transport.calls[1]["payload"], {"resourceId": 7, "directoryPath": "/docs/a.md"})

    def test_download_normalizes_directory_for_backend_zip_branch(self) -> None:
        output = Path(self.temp_dir.name) / "docs.zip"
        self.transport.responses = [{"output": str(output), "bytes": 3}]
        result = self.manager.execute(self.parse("download", "--resource-id", "7", "--directory-path", "/docs", "--output", str(output)))
        self.assertEqual(result["targetType"], "directory")
        self.assertEqual(self.transport.calls[0]["params"]["directoryPath"], "/docs/")

    def test_search_uses_resource_ids_returned_by_backend(self) -> None:
        self.transport.responses = [{"data": [{"knCode": "internal", "resourceId": 7, "filePath": "/a.md", "chunkText": "A"}]}]
        result = self.manager.execute(self.parse("search", "--resource-id", "7", "--query", "A"))
        self.assertEqual(result["items"], [{"resourceId": 7, "filePath": "/a.md", "chunkText": "A"}])
        self.assertNotIn("knCode", result["items"][0])
        self.assertEqual(self.transport.calls[0]["payload"], {"resourceIdList": [7], "query": "A", "topK": 5, "searchMode": "mixedRecall"})

    def test_search_supports_agent_dsl_mode_and_metadata_fields(self) -> None:
        self.transport.responses = [
            {
                "data": [
                    {
                        "resourceId": 7,
                        "filePath": "/a.md",
                        "chunkText": "A",
                        "metadata": {
                            "status": {"valueType": "string", "value": "active"}
                        },
                    }
                ]
            }
        ]
        result = self.manager.execute(
            self.parse(
                "search",
                "--resource-id",
                "7",
                "--query",
                "A",
                "--where-json",
                '{"eq":{"fieldName":"status","value":"active"}}',
                "--metadata-field",
                "status",
                "--metadata-field",
                "filePath",
                "--search-mode",
                "fullTextRecall",
            )
        )
        self.assertEqual(
            self.transport.calls[0]["payload"],
            {
                "resourceIdList": [7],
                "query": "A",
                "where": {"eq": {"fieldName": "status", "value": "active"}},
                "metadataFieldList": ["status", "filePath"],
                "topK": 5,
                "searchMode": "fullTextRecall",
            },
        )
        self.assertEqual(
            result["items"][0]["metadata"]["status"]["value"],
            "active",
        )
        self.assertEqual(result["where"]["eq"]["fieldName"], "status")
        self.assertEqual(result["metadataFields"], ["status", "filePath"])
        self.assertEqual(result["searchMode"], "fullTextRecall")

    def test_metadata_search_uses_pure_metadata_endpoint_and_preserves_pagination(self) -> None:
        self.transport.responses = [
            {
                "data": [
                    {
                        "knCode": "internal",
                        "resourceId": 7,
                        "filePath": "/contracts/a.md",
                        "metadata": {
                            "status": {"valueType": "string", "value": "active"}
                        },
                    }
                ],
                "total": 21,
                "pageNum": 2,
                "pageSize": 10,
            }
        ]
        result = self.manager.execute(
            self.parse(
                "metadata-search",
                "--resource-id",
                "7",
                "--resource-id",
                "8",
                "--where-json",
                '{"eq":{"fieldName":"status","value":"active"}}',
                "--metadata-field",
                "status",
                "--top-k",
                "50",
                "--page-num",
                "2",
                "--page-size",
                "10",
            )
        )

        self.assertEqual(
            self.transport.calls[0],
            {
                "kind": "request",
                "method": "POST",
                "path": "/byaiService/datasetController/knowledgeItems/metadataSearch",
                "payload": {
                    "resourceIdList": [7, 8],
                    "where": {"eq": {"fieldName": "status", "value": "active"}},
                    "metadataFieldList": ["status"],
                    "topK": 50,
                    "pageNum": 2,
                    "pageSize": 10,
                },
            },
        )
        self.assertEqual(result["total"], 21)
        self.assertEqual(result["pageNum"], 2)
        self.assertEqual(result["pageSize"], 10)
        self.assertEqual(
            result["items"],
            [
                {
                    "resourceId": 7,
                    "filePath": "/contracts/a.md",
                    "metadata": {
                        "status": {"valueType": "string", "value": "active"}
                    },
                }
            ],
        )
        self.assertNotIn("knCode", result["items"][0])

    def test_metadata_search_requires_where_and_valid_pagination_ranges(self) -> None:
        parser = manager_module.build_parser()
        invalid_commands = (
            ["metadata-search", "--resource-id", "7"],
            [
                "metadata-search",
                "--resource-id",
                "7",
                "--where-json",
                '{"exists":{"fieldName":"status"}}',
                "--page-num",
                "0",
            ],
            [
                "metadata-search",
                "--resource-id",
                "7",
                "--where-json",
                '{"exists":{"fieldName":"status"}}',
                "--page-size",
                "10001",
            ],
        )
        for argv in invalid_commands:
            with (
                self.subTest(argv=argv),
                redirect_stderr(io.StringIO()),
                self.assertRaises(SystemExit),
            ):
                parser.parse_args(argv)

    def test_agent_dsl_validates_structure_and_complexity(self) -> None:
        valid = manager_module._agent_dsl(
            '{"and":['
            '{"eq":{"fieldName":"status","value":"active"}},'
            '{"contains":{"fieldName":"tags","value":"contract"}}'
            "]}"
        )
        self.assertIn("and", valid)

        invalid_expressions = (
            '{"eq":{"fieldName":"status","value":"active"},'
            '"ne":{"fieldName":"status","value":"disabled"}}',
            '{"and":[]}',
            '{"in":{"fieldName":"status","value":[]}}',
            '{"exists":{"fieldName":"status","value":true}}',
            '{"not":{"not":{"not":{"not":'
            '{"eq":{"fieldName":"status","value":"active"}}}}}}}',
        )
        for expression in invalid_expressions:
            with self.subTest(expression=expression), self.assertRaises(
                manager_module.argparse.ArgumentTypeError
            ):
                manager_module._agent_dsl(expression)

    def test_read_file_preserves_resource_id_and_line_window(self) -> None:
        self.transport.responses = [{"knCode": "internal", "resourceId": 7, "filePath": "/a.md", "startLine": 1, "endLine": 2, "data": "A", "reachedEof": True}]
        result = self.manager.execute(self.parse("read-file", "--resource-id", "7", "--file-path", "/a.md", "--start-line", "1", "--end-line", "2"))
        self.assertEqual(result["file"], {"resourceId": 7, "filePath": "/a.md", "startLine": 1, "endLine": 2, "content": "A", "reachedEof": True})

    def test_entity_discovery_submits_async_batch_and_preserves_task_ids(self) -> None:
        self.transport.responses = [
            {
                "resourceId": 7,
                "batchId": "ed-batch-1",
                "scope": "SINGLE_FILE",
                "taskType": "ENTITY_DISCOVERY",
                "eligibleCount": 1,
                "acceptedCount": 1,
                "reusedCount": 0,
                "skippedCount": 0,
                "tasks": [
                    {
                        "taskId": "task-1",
                        "status": "PENDING",
                        "fileId": "file-1",
                        "filePath": "/docs/a.md",
                        "reused": False,
                    }
                ],
            }
        ]
        result = self.manager.execute(
            self.parse(
                "entity-discovery",
                "--resource-id",
                "7",
                "--file-path",
                "/docs/a.md",
                "--session-id",
                "session-001",
                "--extra-params-json",
                '{"requestSource":"manual"}',
            )
        )
        self.assertTrue(result["accepted"])
        self.assertEqual(result["batch"]["batchId"], "ed-batch-1")
        self.assertEqual(result["batch"]["tasks"][0]["taskId"], "task-1")
        self.assertEqual(
            self.transport.calls[0]["headers"],
            {"X-CHAT-SESSION-ID": "session-001"},
        )
        self.assertEqual(
            self.transport.calls[0]["payload"],
            {
                "resourceId": 7,
                "filePath": "/docs/a.md",
                "maxEntities": 12,
                "force": False,
                "extraParams": {"requestSource": "manual"},
            },
        )

    def test_entity_discovery_supports_recursive_directory_scope(self) -> None:
        result = self.manager.execute(
            self.parse(
                "entity-discovery",
                "--resource-id",
                "7",
                "--directory-path",
                " /docs/manuals ",
                "--dry-run",
            )
        )
        self.assertEqual(
            result,
            {
                "ok": True,
                "action": "entity-discovery",
                "dryRun": True,
                "payload": {
                    "resourceId": 7,
                    "directoryPath": "/docs/manuals",
                    "maxEntities": 12,
                    "force": False,
                },
            },
        )
        self.assertEqual(self.transport.calls, [])

    def test_entity_enrich_supports_whole_kb_dry_run(self) -> None:
        result = self.manager.execute(
            self.parse(
                "entity-enrich",
                "--resource-id",
                "7",
                "--top-k",
                "30",
                "--force",
                "--dry-run",
            )
        )
        self.assertEqual(
            result,
            {
                "ok": True,
                "action": "entity-enrich",
                "dryRun": True,
                "payload": {
                    "resourceId": 7,
                    "topK": 30,
                    "force": True,
                },
            },
        )
        self.assertEqual(self.transport.calls, [])

    def test_entity_enrich_submits_single_file_batch(self) -> None:
        self.transport.responses = [
            {
                "resourceId": 7,
                "batchId": "ee-batch-1",
                "scope": "SINGLE_FILE",
                "taskType": "DOCUMENT_ENRICH",
                "eligibleCount": 1,
                "acceptedCount": 0,
                "reusedCount": 1,
                "skippedCount": 1,
                "tasks": [
                    {
                        "taskId": "task-2",
                        "status": "SKIPPED",
                        "filePath": "/KnowledgeEntity/a.md",
                        "reused": True,
                        "skipReason": "INPUT_UNCHANGED",
                    }
                ],
            }
        ]
        result = self.manager.execute(
            self.parse(
                "entity-enrich",
                "--resource-id",
                "7",
                "--file-path",
                "/KnowledgeEntity/a.md",
                "--top-k",
                "30",
            )
        )
        self.assertEqual(result["batch"]["batchId"], "ee-batch-1")
        self.assertEqual(result["batch"]["tasks"][0]["status"], "SKIPPED")
        self.assertEqual(
            self.transport.calls[0]["payload"],
            {
                "resourceId": 7,
                "filePath": "/KnowledgeEntity/a.md",
                "topK": 30,
                "force": False,
            },
        )

    def test_entity_command_parser_validates_ranges_and_json_object(self) -> None:
        parser = manager_module.build_parser()
        for argv in (
            ["entity-discovery", "--resource-id", "7", "--max-entities", "13"],
            [
                "entity-discovery",
                "--resource-id",
                "7",
                "--file-path",
                "/docs/a.md",
                "--directory-path",
                "/docs",
            ],
            ["entity-enrich", "--resource-id", "7", "--top-k", "0"],
            [
                "entity-discovery",
                "--resource-id",
                "7",
                "--extra-params-json",
                "[]",
            ],
        ):
            with (
                self.subTest(argv=argv),
                redirect_stderr(io.StringIO()),
                self.assertRaises(SystemExit),
            ):
                parser.parse_args(argv)

    def test_argparse_help_lists_commands_and_subcommand_options(self) -> None:
        parser = manager_module.build_parser()
        top_level_help = parser.format_help()
        self.assertIn("管理 ByClaw 知识库", top_level_help)
        self.assertIn("upload", top_level_help)
        self.assertIn("entity-discovery", top_level_help)
        self.assertIn("entity-enrich", top_level_help)
        self.assertIn("查看子命令参数", top_level_help)

        output = io.StringIO()
        with redirect_stdout(output), self.assertRaises(SystemExit) as raised:
            parser.parse_args(["upload", "--help"])
        self.assertEqual(raised.exception.code, 0)
        upload_help = output.getvalue()
        self.assertIn("导入一个或多个文件或 ZIP", upload_help)
        self.assertIn("--resource-id ID", upload_help)
        self.assertIn("--file-path LOCAL_FILE", upload_help)
        self.assertIn("--session-id ID", upload_help)
        self.assertIn("--dry-run", upload_help)

        search_output = io.StringIO()
        with redirect_stdout(search_output), self.assertRaises(SystemExit):
            parser.parse_args(["search", "--help"])
        search_help = search_output.getvalue()
        self.assertNotIn("--session-id", search_help)
        self.assertIn("--where-json JSON", search_help)
        self.assertIn("--metadata-field NAME", search_help)
        self.assertIn("--search-mode", search_help)

        metadata_output = io.StringIO()
        with redirect_stdout(metadata_output), self.assertRaises(SystemExit):
            parser.parse_args(["metadata-search", "--help"])
        metadata_help = metadata_output.getvalue()
        self.assertNotIn("--query", metadata_help)
        self.assertIn("--where-json JSON", metadata_help)
        self.assertIn("--page-num N", metadata_help)
        self.assertIn("--page-size N", metadata_help)

        discovery_output = io.StringIO()
        with redirect_stdout(discovery_output), self.assertRaises(SystemExit):
            parser.parse_args(["entity-discovery", "--help"])
        discovery_help = discovery_output.getvalue()
        self.assertIn("--file-path PATH", discovery_help)
        self.assertIn("--directory-path PATH", discovery_help)
        self.assertIn("递归处理该目录及其子目录", discovery_help)

    def test_main_without_arguments_prints_help(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = manager_module.main([])
        self.assertEqual(exit_code, 0)
        self.assertIn("project-cloud-knowledge [-h] COMMAND", output.getvalue())

    def test_main_passes_session_id_to_write_command_transport(self) -> None:
        captured: dict[str, str] = {}

        class FakeTransport(RecordingTransport):
            def __init__(
                self,
                *,
                session_id: str = "",
                supports_session: bool = False,
            ) -> None:
                super().__init__()
                captured["session_id"] = session_id
                captured["supports_session"] = str(supports_session)

        with patch.object(
            manager_module,
            "ByFrameworkDiscoveryTransport",
            FakeTransport,
        ):
            output = io.StringIO()
            with redirect_stdout(output):
                exit_code = manager_module.main(
                    [
                        "mkdir",
                        "--session-id",
                        "session-001",
                        "--resource-id",
                        "7",
                        "--directory-path",
                        "/",
                        "--directory-name",
                        "docs",
                        "--dry-run",
                    ]
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            captured,
            {"session_id": "session-001", "supports_session": "True"},
        )


if __name__ == "__main__":
    unittest.main()
