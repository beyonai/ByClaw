#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import io
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("by_knowledge_manager.py")
SPEC = importlib.util.spec_from_file_location("by_knowledge_manager", SCRIPT)
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
        self.assertIn("--dry-run", upload_help)

    def test_main_without_arguments_prints_help(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = manager_module.main([])
        self.assertEqual(exit_code, 0)
        self.assertIn("by-knowledge-manager [-h] COMMAND", output.getvalue())


if __name__ == "__main__":
    unittest.main()
