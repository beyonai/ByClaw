from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR / "src"))

from kbcli.cli import build_parser, dispatch  # noqa: E402
from kbcli.errors import KbCliError  # noqa: E402


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def json(self, method, path, *, session_id, payload=None, query=None):
        self.calls.append(("json", method, path, session_id, payload, query))
        return {"code": 0, "msg": "ok", "data": {"resourceId": "2001"}}

    def multipart(self, path, *, session_id, fields, files, file_field="files"):
        self.calls.append(("multipart", path, session_id, fields, files, file_field))
        return {"code": 0, "msg": "ok", "data": {"summary": {"succeeded": 1}}}

    def download(self, path, *, session_id, query, output):
        self.calls.append(("download", path, session_id, query, output))
        output.write_bytes(b"document")
        return {"outputPath": str(output.resolve()), "size": 8}

    def multipart_download(self, path, *, session_id, file, file_field, output):
        self.calls.append(("multipart_download", path, session_id, file, file_field, output))
        output.write_text("# converted", encoding="utf-8")
        return {"outputPath": str(output.resolve()), "size": 11, "contentType": "text/markdown"}

    def text(self, method, path, *, session_id, query=None):
        self.calls.append(("text", method, path, session_id, query))
        return "知识库构建任务已提交"


class CliContractTests(unittest.TestCase):
    def parse(self, *argv: str):
        return build_parser().parse_args(list(argv))

    def test_create_maps_to_dataset_controller_without_endpoint_argument(self):
        args = self.parse(
            "base", "create", "--session-id", "session-1", "--input", '{"resourceName":"HR"}'
        )
        client = FakeClient()
        result = dispatch(args, client)
        self.assertEqual(
            ("json", "POST", "/byaiService/datasetController/createDataset", "session-1",
             {"resourceName": "HR"}, None),
            client.calls[0],
        )
        self.assertTrue(result["ok"])
        self.assertEqual("2001", result["data"]["resourceId"])
        with self.assertRaises(KbCliError):
            self.parse("base", "get", "--session-id", "session-1", "--resource-id", "9",
                       "--endpoint", "http://x")

    def test_base_list_searches_available_knowledge_with_safe_defaults(self):
        args = self.parse(
            "base", "list", "--session-id", "session-1", "--keyword", "人事",
            "--page-num", "2", "--page-size", "20",
        )
        client = FakeClient()
        result = dispatch(args, client)
        self.assertTrue(result["ok"])
        self.assertEqual(
            (
                "json", "POST", "/byaiService/auth/privilegeGrant/listResourceUseAuth",
                "session-1",
                {
                    "keyword": "人事", "pageNum": 2, "pageSize": 20,
                    "resourceStatus": "2",
                    "resourceBizTypeList": ["KG_DOC", "KG_QA", "KG_TERM"],
                    "permission": "", "digitalEmployeeType": "", "language": "zh-CN",
                },
                None,
            ),
            client.calls[0],
        )

    def test_base_list_exposes_only_keyword_and_pagination_filters(self):
        for hidden_flag, value in (
            ("--status", "3"),
            ("--resource-type", "KG_DOC"),
            ("--permission", "CREATED_BY_ME"),
            ("--language", "en-US"),
        ):
            with self.subTest(hidden_flag=hidden_flag), self.assertRaises(KbCliError):
                self.parse(
                    "base", "list", "--session-id", "s1", "--keyword", "x",
                    hidden_flag, value,
                )

        contract = dispatch(self.parse("describe", "base", "list"), FakeClient())["data"]
        self.assertEqual(
            {"sessionId", "keyword", "pageNum", "pageSize"},
            set(contract["input"]["properties"]),
        )

    def test_update_and_delete_execute_directly_without_confirmation_flags(self):
        client = FakeClient()
        update = self.parse(
            "base", "update", "--session-id", "s1", "--input", '{"resourceId":"9","resourceName":"N"}'
        )
        delete = self.parse(
            "folder", "delete", "--session-id", "s1", "--resource-id", "9", "--path", "/old"
        )
        dispatch(update, client)
        dispatch(delete, client)
        self.assertEqual("/byaiService/datasetController/updateDataset", client.calls[0][2])
        self.assertEqual(
            {"resourceId": "9", "directoryPath": "/old"}, client.calls[1][4]
        )
        with self.assertRaises(KbCliError):
            self.parse("folder", "delete", "--session-id", "s1", "--resource-id", "9", "--path", "/old", "--confirm")

    def test_item_list_maps_to_directory_listing_endpoint(self):
        args = self.parse(
            "item", "list", "--session-id", "s1", "--resource-id", "9",
            "--directory", "/Product", "--keyword", "架构",
        )
        client = FakeClient()
        dispatch(args, client)
        self.assertEqual(
            (
                "json", "POST", "/byaiService/datasetController/queryDirAndFileByLevel",
                "s1", {"resourceId": "9", "directoryPath": "/Product", "keyword": "架构"}, None,
            ),
            client.calls[0],
        )

    def test_item_glob_uses_explicit_scalar_path_rule(self):
        args = self.parse(
            "item", "glob", "--session-id", "s1", "--resource-id", "9",
            "--path-rule", "/制度/*/*.md",
        )
        client = FakeClient()
        dispatch(args, client)
        self.assertEqual(
            {"resourceId": "9", "pathRule": "/制度/*/*.md"},
            client.calls[0][4],
        )

    def test_item_glob_rejects_recursive_wildcard_before_backend_call(self):
        args = self.parse(
            "item", "glob", "--session-id", "s1", "--resource-id", "9",
            "--path-rule", "/制度/**/*.md",
        )
        client = FakeClient()
        with self.assertRaises(KbCliError) as captured:
            dispatch(args, client)
        self.assertEqual("INVALID_ARGUMENT", captured.exception.code)
        self.assertEqual([], client.calls)

    def test_item_describe_exposes_list_and_glob_fields(self):
        listing = dispatch(self.parse("describe", "item", "list"), FakeClient())["data"]
        glob = dispatch(self.parse("describe", "item", "glob"), FakeClient())["data"]
        self.assertEqual(
            {"sessionId", "resourceId", "directory", "keyword"},
            set(listing["input"]["properties"]),
        )
        self.assertEqual(
            {"sessionId", "resourceId", "pathRule"},
            set(glob["input"]["properties"]),
        )
        self.assertEqual("string", glob["input"]["properties"]["pathRule"]["type"])
        self.assertIn("不支持 **", " ".join(glob["notes"]))

    def test_chunk_search_uses_backend_supported_default_mode(self):
        args = self.parse(
            "search", "chunks", "--session-id", "s1", "--resource-id", "9",
            "--resource-id", "10", "--query", "leave policy", "--top-k", "5",
        )
        client = FakeClient()
        dispatch(args, client)
        self.assertEqual(
            {
                "resourceIdList": ["9", "10"],
                "query": "leave policy",
                "topK": 5,
                "searchMode": "mixedRecall",
                "where": None,
                "metadataFieldList": [],
                "fileTypeList": [],
            },
            client.calls[0][4],
        )

    def test_search_rejects_unsupported_modes_before_calling_backend(self):
        for action in ("chunks", "files"):
            with self.subTest(action=action), self.assertRaises(KbCliError):
                self.parse(
                    "search", action, "--session-id", "s1", "--resource-id", "9",
                    "--query", "leave policy", "--mode", "hybrid",
                )

    def test_search_describe_exposes_mode_enum_and_default(self):
        for action in ("chunks", "files"):
            contract = dispatch(self.parse("describe", "search", action), FakeClient())["data"]
            mode = contract["input"]["properties"]["mode"]
            self.assertEqual("mixedRecall", mode["default"])
            self.assertEqual(
                ["mixedRecall", "fullTextRecall", "embedding"],
                mode["enum"],
            )

    def test_upload_uses_multipart_and_preserves_repeated_files(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "a.md"
            second = Path(directory) / "b.md"
            first.write_text("a", encoding="utf-8")
            second.write_text("b", encoding="utf-8")
            args = self.parse(
                "file", "upload", "--session-id", "s1", "--resource-id", "9",
                "--directory", "/docs", "--file", str(first), "--file", str(second),
                "--overwrite",
            )
            client = FakeClient()
            dispatch(args, client)
            call = client.calls[0]
            self.assertEqual("multipart", call[0])
            self.assertEqual([first, second], call[4])
            self.assertEqual("true", call[3]["overwrite"])

    def test_update_uses_file_content_multipart_field(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "a.md"
            source.write_text("new", encoding="utf-8")
            args = self.parse(
                "file", "update", "--session-id", "s1", "--resource-id", "9",
                "--path", "/docs/a.md", "--file", str(source),
            )
            client = FakeClient()
            dispatch(args, client)
            self.assertEqual("fileContent", client.calls[0][5])

    def test_file_read_uses_explicit_validated_arguments(self):
        args = self.parse(
            "file", "read", "--session-id", "s1", "--resource-id", "9",
            "--path", "/Ability/MCP 协议服务.md", "--start-line", "1", "--end-line", "500",
        )
        client = FakeClient()
        dispatch(args, client)
        self.assertEqual(
            {
                "resourceId": "9",
                "filePath": "/Ability/MCP 协议服务.md",
                "startLine": 1,
                "endLine": 500,
            },
            client.calls[0][4],
        )

    def test_file_read_rejects_invalid_line_range_before_backend_call(self):
        args = self.parse(
            "file", "read", "--session-id", "s1", "--resource-id", "9",
            "--path", "/a.md", "--start-line", "20", "--end-line", "10",
        )
        client = FakeClient()
        with self.assertRaises(KbCliError) as captured:
            dispatch(args, client)
        self.assertEqual("INVALID_ARGUMENT", captured.exception.code)
        self.assertEqual([], client.calls)

    def test_file_read_describe_exposes_actual_request_fields(self):
        contract = dispatch(self.parse("describe", "file", "read"), FakeClient())["data"]
        self.assertEqual(
            {"sessionId", "resourceId", "path", "startLine", "endLine"},
            set(contract["input"]["properties"]),
        )
        self.assertNotIn("input", contract["input"]["properties"])

    def test_download_refuses_existing_output_unless_force_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "existing.md"
            output.write_text("old", encoding="utf-8")
            args = self.parse(
                "file", "download", "--session-id", "s1", "--resource-id", "9",
                "--path", "/docs/a.md", "--output", str(output),
            )
            with self.assertRaises(KbCliError) as captured:
                dispatch(args, FakeClient())
            self.assertEqual("OUTPUT_EXISTS", captured.exception.code)

    def test_input_dash_reads_json_from_stdin(self):
        args = self.parse("item", "move", "--session-id", "s1", "--input", "-")
        client = FakeClient()
        original = sys.stdin
        try:
            from io import StringIO
            sys.stdin = StringIO('{"resourceId":"9","sourcePath":["/a.md"],"targetDirectoryPath":"/docs"}')
            dispatch(args, client)
        finally:
            sys.stdin = original
        self.assertEqual(
            {"resourceId": "9", "sourcePath": ["/a.md"], "targetDirectoryPath": "/docs"},
            client.calls[0][4],
        )

    def test_describe_returns_machine_readable_input_output_and_errors(self):
        args = self.parse("describe", "base", "get", "--format", "json")
        result = dispatch(args, FakeClient())
        self.assertTrue(result["ok"])
        contract = result["data"]
        self.assertEqual("base get", contract["command"])
        self.assertEqual("GET", contract["http"]["method"])
        self.assertIn("resourceId", contract["input"]["properties"])
        self.assertEqual("DatasetDetail", contract["output"]["dataType"])
        self.assertEqual("string", contract["output"]["dataSchema"]["properties"]["resourceName"]["type"])
        self.assertIn("BACKEND_ERROR", contract["errors"])

    def test_describe_all_lists_every_leaf_command(self):
        args = self.parse("describe", "--all", "--format", "json")
        result = dispatch(args, FakeClient())
        commands = [item["command"] for item in result["data"]]
        self.assertEqual(25, len(commands))
        self.assertEqual(len(commands), len(set(commands)))
        self.assertIn("search metadata", commands)
        self.assertIn("file upload", commands)
        self.assertIn("base list", commands)
        self.assertIn("build start", commands)
        self.assertIn("build convert", commands)
        self.assertIn("build from-doc", commands)
        self.assertIn("build result", commands)
        self.assertIn("build status", commands)

    def test_build_start_and_status_map_explicit_file_paths(self):
        client = FakeClient()
        dispatch(self.parse(
            "build", "start", "--session-id", "s1", "--resource-id", "9",
            "--path", "/docs/a.md",
        ), client)
        dispatch(self.parse(
            "build", "status", "--session-id", "s1", "--resource-id", "9",
            "--path", "/docs/a.md",
        ), client)
        self.assertEqual(
            ("json", "POST", "/byaiService/datasetController/build", "s1",
             {"resourceId": "9", "directoryPath": "/docs/a.md"}, None),
            client.calls[0],
        )
        self.assertEqual(
            ("json", "GET", "/byaiService/datasetController/fileBuildStatus", "s1",
             None, {"resourceId": "9", "directoryPath": "/docs/a.md"}),
            client.calls[1],
        )

    def test_build_result_maps_pagination_and_markdown_flag(self):
        client = FakeClient()
        dispatch(self.parse(
            "build", "result", "--session-id", "s1", "--resource-id", "9",
            "--path", "/docs/a.md", "--chunk-page", "2", "--chunk-page-size", "5",
            "--no-markdown",
        ), client)
        self.assertEqual(
            {
                "resourceId": "9", "filePath": "/docs/a.md", "chunkPage": 2,
                "chunkPageSize": 5, "includeMarkdown": False,
            },
            client.calls[0][4],
        )

    def test_build_convert_writes_markdown_through_multipart_download(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "report.xls"
            output = Path(directory) / "report.md"
            source.write_bytes(b"source")
            result = dispatch(self.parse(
                "build", "convert", "--session-id", "s1", "--file", str(source),
                "--output", str(output),
            ), client := FakeClient())
        self.assertEqual("fileContent", client.calls[0][4])
        self.assertEqual("/byaiService/datasetController/fileToMarkdown", client.calls[0][1])
        self.assertTrue(result["ok"])

    def test_build_from_doc_reads_file_and_calls_text_endpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "generated.md"
            source.write_text("# generated", encoding="utf-8")
            result = dispatch(self.parse(
                "build", "from-doc", "--session-id", "s1", "--resource-id", "9",
                "--directory", "/docs", "--doc-name", "generated.md",
                "--doc-file", str(source),
            ), client := FakeClient())
        self.assertEqual(
            {
                "resourceId": "9", "directoryPath": "/docs", "docName": "generated.md",
                "doc": "# generated", "language": "zh-CN",
            },
            client.calls[0][4],
        )
        self.assertEqual("知识库构建任务已提交", result["data"])

    def test_build_describe_exposes_all_five_contracts(self):
        for action in ("start", "convert", "from-doc", "result", "status"):
            with self.subTest(action=action):
                contract = dispatch(self.parse("describe", "build", action), FakeClient())["data"]
                self.assertEqual(f"build {action}", contract["command"])

    def test_leaf_help_contains_output_contract_summary(self):
        parser = build_parser()
        base_action = next(action for action in parser._actions if action.dest == "group")
        base_parser = base_action.choices["base"]
        action = next(item for item in base_parser._actions if item.dest == "action")
        help_text = action.choices["get"].format_help()
        self.assertIn("Output contract", help_text)
        self.assertIn("DatasetDetail", help_text)


if __name__ == "__main__":
    unittest.main()
