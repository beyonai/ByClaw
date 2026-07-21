#!/usr/bin/env python3
"""Workflow runner command-line contract tests."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("workflow_runner.py")


class WorkflowRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.sources = self.root / "sources"
        self.sources.mkdir()
        (self.sources / "material.md").write_text("source material", encoding="utf-8")
        self.session_root = self.root / "sessions"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_cli(self, *args: str, expected_code: int = 0) -> dict[str, object]:
        result = subprocess.run(
            ["python3", str(SCRIPT), *args],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, expected_code, result.stderr)
        return json.loads(result.stdout)

    def init_task(self) -> Path:
        result = self.run_cli(
            "init",
            "--session-root",
            str(self.session_root),
            "--session-id",
            "session-1",
            "--task-name",
            "整理任务",
            "--source",
            str(self.sources),
            "--source",
            str(self.sources / "material.md"),
        )
        self.assertEqual(result["status"], "ready")
        self.assertIn("Step 1", result["prompt"])
        return self.session_root / "session-1" / "整理任务"

    def complete_step_one(self, task_dir: Path) -> None:
        report = task_dir / "knowledge-organizer" / "step-01" / "read-summary.md"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text("已阅读受控素材。", encoding="utf-8")
        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "1",
            "--report",
            str(report),
        )
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["next_step"], 2)
        self.assertIn("Step 2", result["prompt"])

    def complete_step_two(self, task_dir: Path) -> None:
        workflow_dir = task_dir / "knowledge-organizer"
        details = workflow_dir / "step-02" / "object-details"
        details.mkdir(parents=True)
        (details / "概念.json").write_text(
            json.dumps({"data": {"objectCode": "concept", "objectName": "概念"}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (workflow_dir / "step-02" / "mounted-resources.json").write_text(
            json.dumps({"data": [{"resourceName": "概念"}]}, ensure_ascii=False),
            encoding="utf-8",
        )
        (details / "index.json").write_text(
            json.dumps(
                {
                    "objects": [
                        {
                            "object_name": "概念",
                            "object_code": "concept",
                            "resource_id": "1",
                            "resource_code": "concept",
                            "detail_file": "概念.json",
                        }
                    ]
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        selection = workflow_dir / "step-02" / "selection.json"
        selection.write_text(
            json.dumps(
                {
                    "scope_mode": "agent_selected",
                    "requested_scope": [],
                    "selected": [{"object_name": "概念", "object_code": "concept", "reason": "素材包含定义"}],
                    "excluded": [],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "2",
            "--object-details-dir",
            str(details),
            "--selection-file",
            str(selection),
        )
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["next_step"], 3)

    def complete_step_three_and_four(self, task_dir: Path) -> Path:
        document = task_dir / "新建对象" / "概念" / "示例.md"
        document.parent.mkdir(parents=True, exist_ok=True)
        document.write_text("---\nname: 示例\n---\n正文", encoding="utf-8")
        result = self.run_cli("complete", "--task-dir", str(task_dir), "--step", "3")
        self.assertEqual(result["next_step"], 4)
        batch = task_dir / "knowledge-organizer" / "step-04" / "relations_batch.json"
        batch.parent.mkdir(parents=True, exist_ok=True)
        batch.write_text("[]", encoding="utf-8")
        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "4",
            "--relations-batch",
            str(batch),
        )
        self.assertEqual(result["next_step"], 5)
        return document

    def test_init_creates_workflow_configuration_without_scanning_sources(self) -> None:
        task_dir = self.init_task()
        config = json.loads((task_dir / "knowledge-organizer" / "state.json").read_text(encoding="utf-8"))

        self.assertEqual(config["current_step"], 1)
        self.assertEqual(
            config["sources"],
            [str(self.sources.resolve()), str((self.sources / "material.md").resolve())],
        )
        self.assertFalse((task_dir / "knowledge-organizer" / "source-manifest.json").exists())

    def test_step_two_prompt_contains_the_required_ontology_script_commands(self) -> None:
        task_dir = self.init_task()
        report = task_dir / "knowledge-organizer" / "step-01" / "read-summary.md"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text("已阅读。", encoding="utf-8")

        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "1",
            "--report",
            str(report),
        )

        self.assertIn("list_mounted_resources.py", result["prompt"])
        self.assertIn("get_object.py", result["prompt"])
        self.assertIn('"resource_id":"<数字员工 resource_id>"', result["prompt"])
        self.assertIn("禁止使用 baiying_call", result["prompt"])

    def test_step_four_prompt_contains_batch_format_and_writer_command(self) -> None:
        task_dir = self.init_task()
        state_path = task_dir / "knowledge-organizer" / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["current_step"] = 4
        state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")

        result = self.run_cli("current", "--task-dir", str(task_dir))

        self.assertIn('"doc_path"', result["prompt"])
        self.assertIn('"target_doc_id"', result["prompt"])
        self.assertIn("add_related_docs.py -b", result["prompt"])

    def test_invalid_step_three_returns_incomplete_and_does_not_advance(self) -> None:
        task_dir = self.init_task()
        self.complete_step_one(task_dir)
        self.complete_step_two(task_dir)
        (task_dir / "新建对象" / "概念").mkdir(parents=True)

        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "3",
            expected_code=2,
        )

        self.assertEqual(result["status"], "incomplete")
        self.assertIn("Markdown", result["reasons"][0])
        state = json.loads((task_dir / "knowledge-organizer" / "state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["current_step"], 3)

    def test_step_two_requires_raw_details_for_every_mounted_object(self) -> None:
        task_dir = self.init_task()
        self.complete_step_one(task_dir)
        workflow_dir = task_dir / "knowledge-organizer"
        details = workflow_dir / "step-02" / "object-details"
        details.mkdir(parents=True)
        (details / "概念.json").write_text(
            json.dumps({"data": {"objectCode": "concept", "objectName": "概念"}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (workflow_dir / "step-02" / "mounted-resources.json").write_text(
            json.dumps(
                {"data": [{"resourceName": "概念"}, {"resourceName": "能力"}]},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (details / "index.json").write_text(
            json.dumps(
                {
                    "objects": [
                        {
                            "object_name": "概念",
                            "object_code": "concept",
                            "resource_id": "1",
                            "resource_code": "concept",
                            "detail_file": "概念.json",
                        },
                        {
                            "object_name": "能力",
                            "object_code": "ability",
                            "resource_id": "2",
                            "resource_code": "ability",
                            "detail_file": "能力.json",
                        },
                    ]
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        selection = workflow_dir / "step-02" / "selection.json"
        selection.write_text(
            json.dumps(
                {"selected": [{"object_name": "概念", "object_code": "concept", "reason": "素材包含定义"}]},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "2",
            "--object-details-dir",
            str(details),
            "--selection-file",
            str(selection),
            expected_code=2,
        )

        self.assertEqual(result["status"], "incomplete")
        self.assertTrue(any("能力" in reason for reason in result["reasons"]))

    def test_step_two_rejects_objects_outside_the_user_requested_scope(self) -> None:
        task_dir = self.init_task()
        self.complete_step_one(task_dir)
        workflow_dir = task_dir / "knowledge-organizer"
        details = workflow_dir / "step-02" / "object-details"
        details.mkdir(parents=True)
        for name, code in (("概念", "concept"), ("能力", "ability")):
            (details / f"{name}.json").write_text(
                json.dumps({"data": {"objectCode": code, "objectName": name}}, ensure_ascii=False),
                encoding="utf-8",
            )
        (workflow_dir / "step-02" / "mounted-resources.json").write_text(
            json.dumps({"data": [{"resourceName": "概念"}, {"resourceName": "能力"}]}, ensure_ascii=False),
            encoding="utf-8",
        )
        (details / "index.json").write_text(
            json.dumps(
                {
                    "objects": [
                        {
                            "object_name": "概念",
                            "object_code": "concept",
                            "resource_id": "1",
                            "resource_code": "concept",
                            "detail_file": "概念.json",
                        },
                        {
                            "object_name": "能力",
                            "object_code": "ability",
                            "resource_id": "2",
                            "resource_code": "ability",
                            "detail_file": "能力.json",
                        },
                    ]
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        selection = workflow_dir / "step-02" / "selection.json"
        selection.write_text(
            json.dumps(
                {
                    "scope_mode": "user_specified",
                    "requested_scope": ["概念"],
                    "selected": [{"object_name": "能力", "object_code": "ability", "reason": "素材包含能力"}],
                    "excluded": [{"object_name": "概念", "reason": "无内容"}],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "2",
            "--object-details-dir",
            str(details),
            "--selection-file",
            str(selection),
            expected_code=2,
        )

        self.assertEqual(result["status"], "incomplete")
        self.assertTrue(any("用户指定范围" in reason for reason in result["reasons"]))

    def test_step_six_requires_a_separate_user_confirmation_after_preview(self) -> None:
        task_dir = self.init_task()
        state_path = task_dir / "knowledge-organizer" / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["current_step"] = 7
        state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        preview = task_dir / "knowledge-organizer" / "step-06" / "preview.md"
        preview.parent.mkdir(parents=True, exist_ok=True)
        preview.write_text("已向用户展示预览。", encoding="utf-8")

        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "6",
            "--preview-report",
            str(preview),
        )

        self.assertEqual(result["status"], "awaiting_confirmation")
        state = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertEqual(state["current_step"], 7)
        self.assertEqual(state["preview_presented"], str(preview.resolve()))

    def test_step_five_point_five_requires_fusion_to_keep_the_kb_filename(self) -> None:
        task_dir = self.init_task()
        state_path = task_dir / "knowledge-organizer" / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state.update(
            {
                "current_step": 6,
                "selection": {"selected": [{"object_name": "概念", "object_code": "concept"}]},
            }
        )
        state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        current = task_dir / "新建对象" / "概念" / "新建名称.md"
        candidate = task_dir / "知识库候选" / "概念" / "库中名称.md"
        output = task_dir / "融合结果" / "概念" / "错误名称.md"
        for path in (current, candidate, output):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("---\nname: 示例\n---\n正文", encoding="utf-8")
        results = task_dir / "knowledge-organizer" / "step-05.5" / "entity-resolution-results.md"
        results.parent.mkdir(parents=True, exist_ok=True)
        results.write_text(
            "| object_name | result_status | result_type | current_source_path | candidate_source_path | output_path | detail |\n"
            "| --- | --- | --- | --- | --- | --- | --- |\n"
            f"| 概念 | completed | fusion | {current} | {candidate} | {output} | conflicts=[] |\n",
            encoding="utf-8",
        )

        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "5.5",
            "--entity-resolution-results",
            str(results),
            expected_code=2,
        )

        self.assertEqual(result["status"], "incomplete")
        self.assertTrue(any("同名" in reason for reason in result["reasons"]), result)

    def test_failed_terminates_the_workflow(self) -> None:
        task_dir = self.init_task()
        result = self.run_cli(
            "failed",
            "--task-dir",
            str(task_dir),
            "--step",
            "1",
            "--reason",
            "对象详情服务不可用",
        )
        self.assertEqual(result["status"], "failed")

        result = self.run_cli("current", "--task-dir", str(task_dir), expected_code=1)
        self.assertEqual(result["status"], "failed")

    def test_step_five_rejects_a_relationship_report_with_an_out_of_scope_document(self) -> None:
        task_dir = self.init_task()
        self.complete_step_one(task_dir)
        self.complete_step_two(task_dir)
        document = self.complete_step_three_and_four(task_dir)
        report = task_dir / "knowledge-organizer" / "step-05" / "kb-relations.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(
            json.dumps(
                [
                    {"doc_path": str(document), "clues": [], "relations": []},
                    {"doc_path": str(self.root / "outside.md"), "clues": [], "relations": []},
                ],
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        result = self.run_cli(
            "complete",
            "--task-dir",
            str(task_dir),
            "--step",
            "5",
            "--kb-relations-report",
            str(report),
            expected_code=2,
        )

        self.assertEqual(result["status"], "incomplete")
        self.assertIn("新建对象目录", result["reasons"][0])


if __name__ == "__main__":
    unittest.main()
