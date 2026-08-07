"""Tests for the rewritten knowledge-organizer CLI domain service."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
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

    def extract_fragments(self, **kwargs: object) -> dict[str, object]:
        self.extract_kwargs = kwargs
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


class ConcurrentFakeApi(FakeApi):
    def __init__(self) -> None:
        self.active_extractions = 0
        self.maximum_active_extractions = 0
        self.extract_calls: list[str] = []
        self.failed_contents: set[str] = set()
        self._lock = threading.Lock()

    def extract_fragments(
        self, *, content: str, ads_objects: dict[str, object], user_intent: str | None = None
    ) -> dict[str, object]:
        with self._lock:
            self.active_extractions += 1
            self.maximum_active_extractions = max(self.maximum_active_extractions, self.active_extractions)
            self.extract_calls.append(content)
        try:
            time.sleep(0.03)
            if content in self.failed_contents:
                raise ValueError(f"cannot organize {content}")
            return {
                "fragments": [
                    {
                        "object_code": "concept",
                        "entity_name": content,
                        "content": f"关于 {content} 的知识。",
                    }
                ]
            }
        finally:
            with self._lock:
                self.active_extractions -= 1


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

    def test_discovery_transport_runs_concurrent_coroutines_without_sharing_an_event_loop(self) -> None:
        transport = knowledge_organizer.ByFrameworkDiscoveryTransport()

        async def value_after_wait(value: int) -> tuple[int, int]:
            await knowledge_organizer.asyncio.sleep(0.02)
            return value, id(knowledge_organizer.asyncio.get_running_loop())

        try:
            with ThreadPoolExecutor(max_workers=4) as executor:
                results = list(executor.map(lambda value: transport.run(value_after_wait(value)), range(4)))
        finally:
            transport.close()

        self.assertEqual([value for value, _loop_id in results], [0, 1, 2, 3])
        self.assertEqual(len({loop_id for _value, loop_id in results}), 1)

    def test_extract_json_object_accepts_prose_and_markdown_fence(self) -> None:
        value = knowledge_organizer.extract_json_object(
            "分析完成。\n```json\n{\"fragments\": []}\n```\n以上是结果。"
        )
        self.assertEqual(value, {"fragments": []})

    def test_extract_json_object_rejects_response_without_json_object(self) -> None:
        with self.assertRaisesRegex(ValueError, "JSON"):
            knowledge_organizer.extract_json_object("模型没有遵循格式")

    def test_validated_fragments_removes_whitespace_from_entity_name(self) -> None:
        fragments = self.organizer._validated_fragments(
            {
                "fragments": [
                    {
                        "object_code": "concept",
                        "entity_name": "智 能\t客 服\u3000实例",
                        "content": "智能客服实例的说明。",
                    }
                ]
            },
            {"concept": {}},
        )

        self.assertEqual(fragments[0]["entity_name"], "智能客服实例")

    def test_extract_fragments_treats_user_intent_as_a_hard_scope(self) -> None:
        class RecordingModel:
            def complete_json(self, *, system_prompt: str, user_message: str) -> dict[str, object]:
                self.system_prompt = system_prompt
                self.user_message = user_message
                return {"fragments": []}

        model = RecordingModel()
        api = knowledge_organizer.ServiceApi(object(), model)

        api.extract_fragments(
            content="智能客服与智能外呼的介绍",
            ads_objects={"concept": {"objectCode": "concept"}},
            user_intent="只抽取对象实例：智能客服",
        )

        self.assertIn("只抽取对象实例：智能客服", model.user_message)
        self.assertIn("只输出直接符合该范围的条目", model.system_prompt)

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

    def test_organize_passes_and_persists_user_intent(self) -> None:
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

        self.organizer.organize(self.task_dir, user_intent="仅抽取智能客服实例")

        self.assertEqual(self.api.extract_kwargs["user_intent"], "仅抽取智能客服实例")
        state = self.organizer._load_state(self.task_dir)
        self.assertEqual(state["ingestions"][0]["organize_intent"], "仅抽取智能客服实例")

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

    def test_organize_accepts_candidate_choice_key_with_space_after_colon(self) -> None:
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
        self.api.candidate_choices = {"concept: 智 能\t客服": "old-2"}

        self.organizer.organize(self.task_dir)

        self.assertEqual(self.api.fragment_items[0]["instanceId"], "old-2")
        self.assertFalse(hasattr(self.api, "created_entity"))

    def test_organize_runs_at_most_four_files_concurrently_and_saves_each_completion(self) -> None:
        api = ConcurrentFakeApi()
        organizer = knowledge_organizer.KnowledgeOrganizer(api)
        organizer.initialize(self.task_dir, "employee-1")
        for index in range(5):
            source = Path(self.temp_dir.name) / f"notes-{index}.md"
            source.write_text(f"document-{index}", encoding="utf-8")
            organizer.ingest(
                self.task_dir,
                source=source,
                object_code="raw_doc",
                storage_file_name=f"文档-{index}.md",
                labels={"title": f"文档-{index}"},
            )

        with patch.object(organizer, "_save_state", wraps=organizer._save_state) as save_state:
            fragments = organizer.organize(self.task_dir)

        self.assertEqual(len(fragments), 5)
        self.assertEqual(api.maximum_active_extractions, 4)
        self.assertEqual(save_state.call_count, 5)

    def test_organize_resume_retries_only_failed_or_unfinished_files(self) -> None:
        api = ConcurrentFakeApi()
        organizer = knowledge_organizer.KnowledgeOrganizer(api)
        organizer.initialize(self.task_dir, "employee-1")
        for content in ("successful", "retry-me"):
            source = Path(self.temp_dir.name) / f"{content}.md"
            source.write_text(content, encoding="utf-8")
            organizer.ingest(
                self.task_dir,
                source=source,
                object_code="raw_doc",
                storage_file_name=f"{content}.md",
                labels={"title": content},
            )
        api.failed_contents.add("retry-me")

        first = organizer.organize(self.task_dir)
        second = organizer.organize(self.task_dir)
        api.failed_contents.clear()
        resumed = organizer.organize(self.task_dir, resume=True)

        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertEqual(len(resumed), 1)
        self.assertEqual(api.extract_calls.count("successful"), 1)
        self.assertEqual(api.extract_calls.count("retry-me"), 2)
        state = organizer._load_state(self.task_dir)
        statuses = [ingestion.get("organize_status") for ingestion in state["ingestions"]]
        self.assertEqual(statuses, ["succeeded", "succeeded"])


if __name__ == "__main__":
    unittest.main()
