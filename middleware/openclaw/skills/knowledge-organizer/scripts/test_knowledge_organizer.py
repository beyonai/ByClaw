"""Tests for the rewritten knowledge-organizer CLI domain service."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("knowledge_organizer.py")
SPEC = importlib.util.spec_from_file_location("knowledge_organizer", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
knowledge_organizer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(knowledge_organizer)


class FakeApi:
    def list_authorized_resources(self, _employee_resource_id: str, _page: int) -> dict[str, object]:
        return {
            "totalPages": 1,
            "list": [
                {"resourceBizType": "OBJECT", "resourceCode": "raw_doc"},
                {"resourceBizType": "OBJECT", "resourceCode": "concept"},
            ],
        }

    def get_object(self, object_code: str) -> dict[str, object]:
        domain = "ods" if object_code == "raw_doc" else "ads"
        return {
            "objectCode": object_code,
            "objectName": "原始文档" if domain == "ods" else "概念",
            "objectDesc": f"{domain} object",
            "properties": [{"propertyCode": "title"}],
            "extProperty": {"use_domain": domain},
            "must_not_persist": True,
        }

    def write_document(self, **kwargs: object) -> dict[str, object]:
        self.write_kwargs = kwargs
        return {"records": [{"term_id": "ods-term-1"}]}

    def extract_fragments(self, **_kwargs: object) -> dict[str, object]:
        return {
            "fragments": [
                {
                    "object_code": "concept",
                    "entity_name": "智能客服",
                    "content": "智能客服可以自动响应用户咨询。",
                    "evidence": "正文",
                    "confidence": 0.8,
                },
                {
                    "object_code": "concept",
                    "entity_name": "智能客服",
                    "content": "智能客服支持多轮对话。",
                    "evidence": "正文",
                    "confidence": 0.8,
                },
            ]
        }

    def search_entities(self, *, object_code: str, entity_names: list[str]) -> dict[str, list[dict[str, str]]]:
        self.search_request = (object_code, entity_names)
        return {name: getattr(self, "search_hits", {}).get(name, []) for name in entity_names}

    def select_entity_candidates(self, *, ambiguous: list[dict[str, object]]) -> dict[str, str | None]:
        self.ambiguous = ambiguous
        return getattr(self, "candidate_choices", {})

    def create_entity(self, *, object_code: str, entity_name: str) -> str:
        self.created_entity = (object_code, entity_name)
        return "ads-term-1"

    def create_fragments(self, *, items: list[dict[str, str]]) -> list[dict[str, object]]:
        self.fragment_items = items
        return [{"id": index + 1} for index, _item in enumerate(items)]

    def build_object_instances(self, *, instance_ids: list[str], batch_size: int) -> dict[str, str]:
        self.build_request = (instance_ids, batch_size)
        return {"status": "accepted"}


class KnowledgeOrganizerInitializationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.task_dir = Path(self.temp_dir.name) / "语义化任务"
        self.api = FakeApi()
        self.organizer = knowledge_organizer.KnowledgeOrganizer(self.api)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_init_writes_filtered_object_snapshots_by_domain(self) -> None:
        self.organizer.initialize(self.task_dir, "employee-1")

        ods = json.loads(
            (self.task_dir / "knowledge-organizer" / "objects" / "ods" / "原始文档.json").read_text(
                encoding="utf-8"
            )
        )
        ads = json.loads(
            (self.task_dir / "knowledge-organizer" / "objects" / "ads" / "概念.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(set(ods), {"objectCode", "objectName", "objectDesc", "properties"})
        self.assertEqual(ods["objectCode"], "raw_doc")
        self.assertEqual(ads["objectCode"], "concept")

    def test_cli_exposes_only_the_four_workflow_commands(self) -> None:
        result = subprocess.run(
            ["python3", str(SCRIPT), "--help"], check=False, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("{init,ingest,organize,build}", result.stdout)
        self.assertNotIn("run", result.stdout)

    def test_extract_json_object_accepts_prose_and_markdown_fence(self) -> None:
        value = knowledge_organizer.extract_json_object(
            "分析完成。\n```json\n{\"fragments\": []}\n```\n以上是结果。"
        )
        self.assertEqual(value, {"fragments": []})

    def test_extract_json_object_rejects_response_without_json_object(self) -> None:
        with self.assertRaisesRegex(ValueError, "JSON"):
            knowledge_organizer.extract_json_object("模型没有遵循格式")

    def test_ingest_snapshots_file_and_persists_ods_term_id(self) -> None:
        self.organizer.initialize(self.task_dir, "employee-1")
        source = Path(self.temp_dir.name) / "notes.md"
        source.write_text("# 标题\n正文", encoding="utf-8")

        result = self.organizer.ingest(
            self.task_dir,
            source=source,
            object_code="raw_doc",
            storage_file_name="客户访谈记录.md",
            labels={"title": "标题"},
        )

        self.assertEqual(result["term_id"], "ods-term-1")
        state = json.loads((self.task_dir / "knowledge-organizer" / "state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["ingestions"][0]["term_id"], "ods-term-1")
        self.assertTrue(Path(state["ingestions"][0]["snapshot_path"]).is_file())
        self.assertEqual(self.api.write_kwargs["object_code"], "raw_doc")
        self.assertEqual(self.api.write_kwargs["labels"], {"title": "标题"})

    def test_ingest_rejects_ads_object_and_unknown_label(self) -> None:
        self.organizer.initialize(self.task_dir, "employee-1")
        source = Path(self.temp_dir.name) / "notes.txt"
        source.write_text("正文", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "ODS"):
            self.organizer.ingest(
                self.task_dir,
                source=source,
                object_code="concept",
                storage_file_name="记录.txt",
                labels={},
            )
        with self.assertRaisesRegex(ValueError, "labels"):
            self.organizer.ingest(
                self.task_dir,
                source=source,
                object_code="raw_doc",
                storage_file_name="记录.txt",
                labels={"unknown": "x"},
            )

    def test_organize_creates_missing_entity_and_build_deduplicates_instance_id(self) -> None:
        self.organizer.initialize(self.task_dir, "employee-1")
        source = Path(self.temp_dir.name) / "notes.md"
        source.write_text("# 智能客服\n支持多轮对话", encoding="utf-8")
        self.organizer.ingest(
            self.task_dir,
            source=source,
            object_code="raw_doc",
            storage_file_name="智能客服说明.md",
            labels={"title": "智能客服"},
        )

        fragments = self.organizer.organize(self.task_dir)
        builds = self.organizer.build(self.task_dir)

        self.assertEqual(len(fragments), 2)
        self.assertEqual(self.api.created_entity, ("concept", "智能客服"))
        self.assertEqual(
            self.api.fragment_items,
            [
                {
                    "instanceId": "ads-term-1",
                    "originInstanceId": "ods-term-1",
                    "content": "智能客服可以自动响应用户咨询。",
                },
                {
                    "instanceId": "ads-term-1",
                    "originInstanceId": "ods-term-1",
                    "content": "智能客服支持多轮对话。",
                },
            ],
        )
        self.assertEqual(builds[0]["status"], "accepted")
        self.assertEqual(self.api.build_request, (["ads-term-1"], 1))

    def test_organize_uses_one_model_choice_for_multiple_entity_candidates(self) -> None:
        self.organizer.initialize(self.task_dir, "employee-1")
        source = Path(self.temp_dir.name) / "notes.md"
        source.write_text("# 智能客服", encoding="utf-8")
        self.organizer.ingest(
            self.task_dir,
            source=source,
            object_code="raw_doc",
            storage_file_name="智能客服说明.md",
            labels={"title": "智能客服"},
        )
        self.api.search_hits = {
            "智能客服": [{"instance_id": "old-1"}, {"instance_id": "old-2"}],
        }
        self.api.candidate_choices = {"concept:智能客服": "old-2"}

        self.organizer.organize(self.task_dir)

        self.assertEqual(len(self.api.ambiguous), 1)
        self.assertEqual(self.api.fragment_items[0]["instanceId"], "old-2")
        self.assertFalse(hasattr(self.api, "created_entity"))


if __name__ == "__main__":
    unittest.main()
