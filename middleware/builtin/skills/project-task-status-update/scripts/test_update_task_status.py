"""Tests for the project-task-status-update CLI."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("update_task_status.py")
SPEC = importlib.util.spec_from_file_location("update_task_status", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
update_task_status = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(update_task_status)


DICTIONARY = [
    {
        "dimensionName": "业务状态",
        "statusCode": "REQUIREMENT",
        "statusName": "需求阶段",
        "statusDesc": "知识采集",
        "sortOrder": 1,
    },
    {
        "dimensionName": "业务状态",
        "statusCode": "COLLECT",
        "statusName": "采集阶段",
        "statusDesc": "资料采集",
        "sortOrder": 2,
    },
]


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class UpdateTaskStatusTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.dictionary_file = self.root / "dictionary.json"
        self.status_file = self.root / "11059656.json"
        write_json(self.dictionary_file, DICTIONARY)
        write_json(
            self.status_file,
            {
                "schema_version": "2.0.0",
                "revision": 6,
                "session_id": "11059656",
                "status": "paused",
                "status_label": "暂停",
                "transitions": [],
            },
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_update_writes_task_statuses_without_touching_runtime_status(self) -> None:
        result = update_task_status.run_update(
            update_task_status.build_parser().parse_args(
                [
                    "update",
                    "--session-id",
                    "11059656",
                    "--project-id",
                    "123",
                    "--dimension-name",
                    "业务状态",
                    "--status-code",
                    "REQUIREMENT",
                    "--reason",
                    "进入需求澄清",
                    "--status-file",
                    str(self.status_file),
                    "--dictionary-file",
                    str(self.dictionary_file),
                ]
            )
        )
        payload = json.loads(self.status_file.read_text(encoding="utf-8"))
        self.assertEqual(result["revision"], 7)
        self.assertEqual(payload["status"], "paused")
        self.assertEqual(payload["revision"], 7)
        self.assertEqual(payload["task_statuses"][0]["status_code"], "REQUIREMENT")
        self.assertEqual(payload["task_statuses"][0]["status_name"], "需求阶段")
        self.assertEqual(payload["transitions"][0]["to"], "REQUIREMENT")

    def test_update_replaces_same_dimension(self) -> None:
        update_task_status.run_update(
            update_task_status.build_parser().parse_args(
                [
                    "update",
                    "--session-id",
                    "11059656",
                    "--project-id",
                    "123",
                    "--dimension-name",
                    "业务状态",
                    "--status-code",
                    "REQUIREMENT",
                    "--status-file",
                    str(self.status_file),
                    "--dictionary-file",
                    str(self.dictionary_file),
                ]
            )
        )
        update_task_status.run_update(
            update_task_status.build_parser().parse_args(
                [
                    "update",
                    "--session-id",
                    "11059656",
                    "--project-id",
                    "123",
                    "--dimension-name",
                    "业务状态",
                    "--status-code",
                    "COLLECT",
                    "--status-file",
                    str(self.status_file),
                    "--dictionary-file",
                    str(self.dictionary_file),
                ]
            )
        )
        payload = json.loads(self.status_file.read_text(encoding="utf-8"))
        self.assertEqual(len(payload["task_statuses"]), 1)
        self.assertEqual(payload["task_statuses"][0]["status_code"], "COLLECT")
        self.assertEqual(payload["revision"], 8)
        self.assertEqual(payload["transitions"][-1]["from"], "REQUIREMENT")

    def test_update_rejects_unknown_status_code(self) -> None:
        with self.assertRaisesRegex(ValueError, "状态不在项目字典中"):
            update_task_status.run_update(
                update_task_status.build_parser().parse_args(
                    [
                        "update",
                        "--session-id",
                        "11059656",
                        "--project-id",
                        "123",
                        "--dimension-name",
                        "业务状态",
                        "--status-code",
                        "UNKNOWN",
                        "--status-file",
                        str(self.status_file),
                        "--dictionary-file",
                        str(self.dictionary_file),
                    ]
                )
            )
        payload = json.loads(self.status_file.read_text(encoding="utf-8"))
        self.assertNotIn("task_statuses", payload)

    def test_cli_prints_json_and_returns_nonzero_on_failure(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "update",
                "--session-id",
                "11059656",
                "--project-id",
                "123",
                "--dimension-name",
                "业务状态",
                "--status-code",
                "UNKNOWN",
                "--status-file",
                str(self.status_file),
                "--dictionary-file",
                str(self.dictionary_file),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        payload = json.loads(completed.stdout)
        self.assertFalse(payload["ok"])


if __name__ == "__main__":
    unittest.main()
