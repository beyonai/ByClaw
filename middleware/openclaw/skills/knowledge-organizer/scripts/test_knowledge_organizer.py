"""Tests for the knowledge-organizer CLI domain service."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("knowledge_organizer.py")
SPEC = importlib.util.spec_from_file_location("knowledge_organizer", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
knowledge_organizer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(knowledge_organizer)


class FakeApi:
    def __init__(self) -> None:
        self.agent_resource_calls: list[tuple[str, int]] = []
        self.session_resource_calls: list[str] = []
        self.saved_object_instances: list[dict[str, object]] = []
        self.discovery_calls: list[tuple[str, list[str], list[str]]] = []
        self.enrichment_calls: list[tuple[str, list[str]]] = []
        self.task_status_calls: list[tuple[int, str]] = []

    def list_authorized_resources(
        self, employee_resource_id: str, page: int
    ) -> dict[str, object]:
        self.agent_resource_calls.append((employee_resource_id, page))
        return {
            "totalPages": 1,
            "list": [
                {"resourceBizType": "OBJECT", "resourceCode": "raw_doc"},
                {"resourceBizType": "OBJECT", "resourceCode": "concept"},
                {"resourceBizType": "VIEW", "resourceCode": "ignored_view"},
            ],
        }

    def list_session_resources(self, *, session_id: str) -> list[dict[str, object]]:
        self.session_resource_calls.append(session_id)
        return [
            {"objectCode": "raw_doc", "kbDirectory": "/原始资料"},
            {"objectCode": "concept", "kbDirectory": "/概念"},
            {"objectCode": "concept", "kbDirectory": "/概念"},
        ]

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

    def save_object_instance(
        self, *, payload: dict[str, object]
    ) -> dict[str, object]:
        self.saved_object_instances.append(payload)
        return {
            "records": [{"term_id": "term-11041854"}],
            "total": 1,
            "meta": {},
        }

    def discover_document_objects(
        self,
        *,
        session_id: str,
        source_object_codes: list[str],
        object_codes: list[str],
    ) -> dict[str, object]:
        self.discovery_calls.append((session_id, source_object_codes, object_codes))
        return {
            "sessionId": session_id,
            "taskType": "documentDiscovery",
            "accepted": True,
        }

    def enrich_document_objects(
        self, *, session_id: str, object_codes: list[str]
    ) -> dict[str, object]:
        self.enrichment_calls.append((session_id, object_codes))
        return {
            "sessionId": session_id,
            "taskType": "documentEnrichment",
            "accepted": True,
        }

    def update_task_status(self, *, session_id: int, task_status: str) -> None:
        self.task_status_calls.append((session_id, task_status))


class RecordingTransport:
    def __init__(self, responses: list[object]) -> None:
        self.responses = responses
        self.requests: list[dict[str, object]] = []

    def request(self, **kwargs: object) -> object:
        self.requests.append(kwargs)
        return self.responses.pop(0)

    def close(self) -> None:
        return None


class RedisConfigAdapterTests(unittest.TestCase):
    def load_config(self, environment: dict[str, str]) -> dict[str, object]:
        with patch.dict(os.environ, environment, clear=True):
            return knowledge_organizer._redis_config_from_env(dict)

    def test_cluster_config_ignores_empty_standalone_values(self) -> None:
        config = self.load_config(
            {
                "REDIS_CLUSTER_HOST": "redis-1:6371, redis-2:6372",
                "REDIS_USERNAME": "cluster-user",
                "REDIS_PASSWORD": "cluster-password",
                "REDIS_HOST": "",
                "REDIS_PORT": "",
            }
        )

        self.assertEqual(config["mode"], "cluster")
        self.assertEqual(config["cluster_nodes"], [("redis-1", 6371), ("redis-2", 6372)])
        self.assertEqual(config["host"], "localhost")
        self.assertEqual(config["port"], 6379)
        self.assertEqual(config["username"], "cluster-user")
        self.assertEqual(config["password"], "cluster-password")

    def test_standard_cluster_config_supports_both_node_variable_names(self) -> None:
        for variable in ("REDIS_CLUSTER_HOST", "REDIS_CLUSTER_NODES"):
            with self.subTest(variable=variable):
                config = self.load_config({variable: "redis-1:6379,redis-2:6380"})

                self.assertEqual(config["mode"], "cluster")
                self.assertEqual(
                    config["cluster_nodes"],
                    [("redis-1", 6379), ("redis-2", 6380)],
                )

    def test_standalone_config_uses_standard_values(self) -> None:
        config = self.load_config(
            {
                "REDIS_HOST": "redis-single",
                "REDIS_PORT": "6381",
                "REDIS_DATABASE": "2",
                "REDIS_USERNAME": "redis-user",
                "REDIS_PASSWORD": "redis-password",
            }
        )

        self.assertEqual(config["mode"], "standalone")
        self.assertIsNone(config["cluster_nodes"])
        self.assertEqual(config["host"], "redis-single")
        self.assertEqual(config["port"], 6381)
        self.assertEqual(config["db"], 2)
        self.assertEqual(config["username"], "redis-user")
        self.assertEqual(config["password"], "redis-password")

    def test_empty_standalone_config_uses_safe_defaults(self) -> None:
        config = self.load_config(
            {
                "REDIS_HOST": "",
                "REDIS_PORT": "",
                "REDIS_DATABASE": "",
                "REDIS_USERNAME": "",
                "REDIS_PASSWORD": "",
            }
        )

        self.assertEqual(config["mode"], "standalone")
        self.assertEqual(config["host"], "localhost")
        self.assertEqual(config["port"], 6379)
        self.assertEqual(config["db"], 0)
        self.assertIsNone(config["username"])
        self.assertEqual(config["password"], "")


class KnowledgeOrganizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.task_dir = Path(self.temp_dir.name) / "语义化任务"
        self.api = FakeApi()
        self.organizer = knowledge_organizer.KnowledgeOrganizer(self.api)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def initialize_agent_scope(self) -> dict[str, object]:
        return self.organizer.initialize(
            self.task_dir,
            session_id="session-001",
            employee_resource_id="employee-1",
        )

    def initialize_session_scope(self) -> dict[str, object]:
        return self.organizer.initialize(
            self.task_dir,
            session_id="session-001",
        )

    def test_agent_scope_init_uses_digital_employee_resources(self) -> None:
        result = self.initialize_agent_scope()

        self.assertEqual(result["resource_scope"], "agent")
        self.assertEqual(self.api.agent_resource_calls, [("employee-1", 1)])
        self.assertEqual(self.api.session_resource_calls, [])
        state = self.organizer._load_state(self.task_dir)
        self.assertEqual(state["session_id"], "session-001")
        self.assertEqual(state["employee_resource_id"], "employee-1")
        self.assertEqual({item["object_code"] for item in state["objects"]}, {"raw_doc", "concept"})

    def test_session_scope_init_uses_only_session_id_and_fetches_object_details(self) -> None:
        result = self.initialize_session_scope()

        self.assertEqual(result["resource_scope"], "session")
        self.assertEqual(
            self.api.session_resource_calls,
            ["session-001"],
        )
        self.assertEqual(self.api.agent_resource_calls, [])
        state = self.organizer._load_state(self.task_dir)
        directories = {
            item["object_code"]: item["kb_directory"] for item in state["objects"]
        }
        self.assertEqual(directories["raw_doc"], "/原始资料")
        self.assertTrue(
            (
                self.task_dir
                / "knowledge-organizer"
                / "objects"
                / "ods"
                / "原始文档.json"
            ).is_file()
        )
        self.assertTrue(
            (
                self.task_dir
                / "knowledge-organizer"
                / "objects"
                / "ads"
                / "概念.json"
            ).is_file()
        )

    def test_init_normalizes_session_id_wrapped_in_quotes(self) -> None:
        for quoted_session_id in (
            '"session-001"',
            "'session-001'",
            '  "\'session-001\'"  ',
        ):
            with self.subTest(session_id=quoted_session_id):
                task_dir = self.task_dir / quoted_session_id.strip()
                organizer = knowledge_organizer.KnowledgeOrganizer(FakeApi())

                result = organizer.initialize(
                    task_dir,
                    session_id=quoted_session_id,
                )

                self.assertEqual(result["session_id"], "session-001")
                state = organizer._load_state(task_dir)
                self.assertEqual(state["session_id"], "session-001")

    def test_init_rejects_session_id_containing_only_quotes(self) -> None:
        with self.assertRaisesRegex(ValueError, "session id is required"):
            self.organizer.initialize(self.task_dir, session_id='  ""  ')

    def test_init_no_longer_requires_both_ods_and_ads(self) -> None:
        class OdsOnlyApi(FakeApi):
            def list_session_resources(
                self, *, session_id: str
            ) -> list[dict[str, object]]:
                return [{"objectCode": "raw_doc"}]

        organizer = knowledge_organizer.KnowledgeOrganizer(OdsOnlyApi())
        result = organizer.initialize(
            self.task_dir,
            session_id="session-001",
        )

        self.assertEqual(result["object_codes"], {"ods": ["raw_doc"], "ads": []})

    def test_service_api_uses_documented_backend_contracts(self) -> None:
        transport = RecordingTransport(
            [
                [{"objectCode": "raw_doc"}],
                {"records": [{"term_id": "term-7"}], "total": 1, "meta": {}},
                None,
            ]
        )
        api = knowledge_organizer.ServiceApi(transport)

        resources = api.list_session_resources(session_id="session-001")
        api.save_object_instance(payload={"objectCode": "raw_doc"})
        api.update_task_status(session_id=11036157, task_status="done")

        self.assertEqual(resources, [{"objectCode": "raw_doc"}])

        self.assertEqual(
            transport.requests[0],
            {
                "service_env": "BE_DOMAINNAME",
                "method": "POST",
                "path": "/byaiService/devloop/operation/listObjectById",
                "payload": {"sessionId": "session-001"},
            },
        )
        self.assertEqual(
            transport.requests[1],
            {
                "service_env": "BE_DOMAINNAME",
                "method": "POST",
                "path": "/byaiService/devloop/operation/saveObjectInstanceToKb",
                "payload": {"objectCode": "raw_doc"},
            },
        )
        self.assertEqual(
            transport.requests[2],
            {
                "service_env": "BE_DOMAINNAME",
                "method": "POST",
                "path": "/byaiService/devloop/operation/updateTaskStatus",
                "payload": {"sessionId": 11036157, "taskStatus": "done"},
            },
        )

    def test_update_task_status_accepts_only_supported_terminal_statuses(self) -> None:
        for task_status in ("failed", "done", "mixed"):
            with self.subTest(task_status=task_status):
                result = self.organizer.update_task_status(
                    session_id='"11036157"',
                    task_status=task_status,
                )

                self.assertEqual(result["session_id"], 11036157)
                self.assertEqual(result["task_status"], task_status)

        self.assertEqual(
            self.api.task_status_calls,
            [
                (11036157, "failed"),
                (11036157, "done"),
                (11036157, "mixed"),
            ],
        )

    def test_update_task_status_rejects_non_numeric_session_and_other_statuses(self) -> None:
        with self.assertRaisesRegex(ValueError, "数值型 session id"):
            self.organizer.update_task_status(
                session_id="session-001",
                task_status="done",
            )
        with self.assertRaisesRegex(ValueError, "仅支持"):
            self.organizer.update_task_status(
                session_id="11036157",
                task_status="running",
            )

        self.assertEqual(self.api.task_status_calls, [])

    def test_ingest_snapshots_source_and_saves_object_instance_to_kb(self) -> None:
        self.initialize_session_scope()
        source = Path(self.temp_dir.name) / "客户访谈.md"
        source.write_text("# 客户访谈\n正文", encoding="utf-8")

        result = self.organizer.ingest(
            self.task_dir,
            source=source,
            object_code="raw_doc",
            storage_file_name="客户访谈.md",
            ext_content={"source": "interview"},
        )

        self.assertEqual(result["term_id"], "term-11041854")
        payload = self.api.saved_object_instances[0]
        self.assertEqual(payload["sessionId"], "session-001")
        self.assertEqual(payload["objectCode"], "raw_doc")
        self.assertEqual(payload["actionCode"], "write_raw_doc")
        self.assertEqual(
            payload["arguments"],
            {
                "sourcePath": "/原始资料/客户访谈.md",
                "content": "# 客户访谈\n正文",
                "fileDescription": "客户访谈",
                "labels": {"source": "interview"},
            },
        )
        self.assertEqual(
            result["ext_content"],
            {"source": "interview"},
        )
        self.assertTrue(Path(result["snapshot_path"]).is_file())

    def test_ingest_is_idempotent_for_same_content_and_object(self) -> None:
        self.initialize_agent_scope()
        source = Path(self.temp_dir.name) / "notes.json"
        source.write_text('{"title":"test"}', encoding="utf-8")

        first = self.organizer.ingest(
            self.task_dir,
            source=source,
            object_code="raw_doc",
            storage_file_name="对象资料.json",
        )
        second = self.organizer.ingest(
            self.task_dir,
            source=source,
            object_code="raw_doc",
            storage_file_name="对象资料.json",
        )

        self.assertEqual(first, second)
        self.assertEqual(len(self.api.saved_object_instances), 1)

    def test_ingest_rejects_ads_object(self) -> None:
        self.initialize_session_scope()
        source = Path(self.temp_dir.name) / "notes.md"
        source.write_text("# 标题", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "ODS"):
            self.organizer.ingest(
                self.task_dir,
                source=source,
                object_code="concept",
                storage_file_name="对象资料.md",
            )

    def test_ingest_succeeds_when_backend_returns_non_empty_records(self) -> None:
        class RecordWithoutTermIdApi(FakeApi):
            def save_object_instance(
                self, *, payload: dict[str, object]
            ) -> dict[str, object]:
                return {"records": [{"filePath": "/raw_doc/对象资料.md"}], "total": 1}

        organizer = knowledge_organizer.KnowledgeOrganizer(RecordWithoutTermIdApi())
        organizer.initialize(self.task_dir, session_id="session-001")
        source = Path(self.temp_dir.name) / "notes.md"
        source.write_text("# 标题", encoding="utf-8")

        result = organizer.ingest(
            self.task_dir,
            source=source,
            object_code="raw_doc",
            storage_file_name="对象资料.md",
        )

        self.assertEqual(result["status"], "succeeded")
        self.assertIsNone(result["term_id"])

    def test_ingest_records_failure_when_backend_records_are_empty(self) -> None:
        class EmptyRecordsApi(FakeApi):
            def save_object_instance(
                self, *, payload: dict[str, object]
            ) -> dict[str, object]:
                return {"records": [], "total": 0}

        organizer = knowledge_organizer.KnowledgeOrganizer(EmptyRecordsApi())
        organizer.initialize(self.task_dir, session_id="session-001")
        source = Path(self.temp_dir.name) / "notes.md"
        source.write_text("# 标题", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "records"):
            organizer.ingest(
                self.task_dir,
                source=source,
                object_code="raw_doc",
                storage_file_name="对象资料.md",
            )

    def test_organize_defaults_to_all_ods_sources_and_ads_targets(self) -> None:
        self.initialize_session_scope()

        result = self.organizer.organize(self.task_dir)

        self.assertEqual(result["status"], "accepted")
        self.assertEqual(
            self.api.discovery_calls,
            [("session-001", ["raw_doc"], ["concept"])],
        )
        state = self.organizer._load_state(self.task_dir)
        self.assertEqual(len(state["ingestions"]), 0)
        self.assertEqual(state["discoveries"][0]["source_object_codes"], ["raw_doc"])
        self.assertEqual(state["discoveries"][0]["task_type"], "documentDiscovery")

    def test_build_runs_after_init_without_ingest_or_organize(self) -> None:
        self.initialize_agent_scope()

        result = self.organizer.build(self.task_dir)

        self.assertEqual(result["status"], "accepted")
        self.assertEqual(
            self.api.enrichment_calls,
            [("session-001", ["concept"])],
        )
        state = self.organizer._load_state(self.task_dir)
        self.assertEqual(len(state["ingestions"]), 0)
        self.assertEqual(len(state["discoveries"]), 0)
        self.assertEqual(state["enrichments"][0]["task_type"], "documentEnrichment")

    def test_organize_and_build_reject_ods_objects(self) -> None:
        self.initialize_session_scope()

        with self.assertRaisesRegex(ValueError, "ADS"):
            self.organizer.organize(self.task_dir, ["raw_doc"])
        with self.assertRaisesRegex(ValueError, "ADS"):
            self.organizer.build(self.task_dir, ["raw_doc"])

    def test_organize_rejects_ads_source_objects(self) -> None:
        self.initialize_session_scope()

        with self.assertRaisesRegex(ValueError, "ODS"):
            self.organizer.organize(
                self.task_dir,
                object_codes=["concept"],
                source_object_codes=["concept"],
            )

    def test_async_datacloud_calls_send_session_header(self) -> None:
        transport = RecordingTransport(
            [
                {
                    "sessionId": "session-001",
                    "taskType": "documentDiscovery",
                    "accepted": True,
                },
                {
                    "sessionId": "session-001",
                    "taskType": "documentEnrichment",
                    "accepted": True,
                },
            ]
        )
        api = knowledge_organizer.ServiceApi(transport)

        with patch.dict(os.environ, {"USER_CODE": "user-001"}):
            api.discover_document_objects(
                session_id="session-001",
                source_object_codes=["raw_doc"],
                object_codes=["concept"],
            )
            api.enrich_document_objects(
                session_id="session-001",
                object_codes=["concept"],
            )

        self.assertEqual(
            transport.requests[0],
            {
                "service_env": "DATACLOUD_DOMAINNAME",
                "method": "POST",
                "path": "/api/v1/rpc/kb/discoverDocumentObjectsAsync",
                "payload": {
                    "params": {
                        "sourceObjectCodes": ["raw_doc"],
                        "objectCodes": ["concept"],
                    }
                },
                "headers": {
                    "X-Session-Id": "session-001",
                    "X-User-Code": "user-001",
                },
            },
        )
        self.assertEqual(
            transport.requests[1],
            {
                "service_env": "DATACLOUD_DOMAINNAME",
                "method": "POST",
                "path": "/api/v1/rpc/kb/enrichDocumentObjectsAsync",
                "payload": {"params": {"objectCodes": ["concept"]}},
                "headers": {
                    "X-Session-Id": "session-001",
                    "X-User-Code": "user-001",
                },
            },
        )

    def test_async_datacloud_calls_require_user_code(self) -> None:
        api = knowledge_organizer.ServiceApi(RecordingTransport([]))

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "USER_CODE"):
                api.discover_document_objects(
                    session_id="session-001",
                    source_object_codes=["raw_doc"],
                    object_codes=["concept"],
                )

    def test_async_commands_reject_uninitialized_and_unauthorized_objects(self) -> None:
        with self.assertRaisesRegex(ValueError, "未初始化"):
            self.organizer.organize(self.task_dir, ["raw_doc"])

        self.initialize_session_scope()
        with self.assertRaisesRegex(ValueError, "未授权"):
            self.organizer.build(self.task_dir, ["unknown"])

    def test_async_rejection_is_recorded_as_failure(self) -> None:
        class RejectingApi(FakeApi):
            def discover_document_objects(
                self,
                *,
                session_id: str,
                source_object_codes: list[str],
                object_codes: list[str],
            ) -> dict[str, object]:
                return {
                    "sessionId": session_id,
                    "taskType": "documentDiscovery",
                    "accepted": False,
                }

        organizer = knowledge_organizer.KnowledgeOrganizer(RejectingApi())
        organizer.initialize(
            self.task_dir,
            session_id="session-001",
        )

        with self.assertRaisesRegex(ValueError, "accepted=true"):
            organizer.organize(
                self.task_dir,
                object_codes=["concept"],
                source_object_codes=["raw_doc"],
            )

        state = organizer._load_state(self.task_dir)
        self.assertEqual(state["discoveries"][0]["status"], "failed")
        self.assertFalse(state["discoveries"][0]["accepted"])

    def test_cli_exposes_five_commands_and_new_arguments(self) -> None:
        result = subprocess.run(
            ["python3", str(SCRIPT), "--help"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn(
            "{init,ingest,organize,build,update-task-status}",
            result.stdout,
        )

        init_help = subprocess.run(
            ["python3", str(SCRIPT), "init", "--help"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertIn("--session-id", init_help.stdout)
        self.assertNotIn("--item-id", init_help.stdout)
        self.assertIn("--digital-employee-resource-id", init_help.stdout)

        ingest_help = subprocess.run(
            ["python3", str(SCRIPT), "ingest", "--help"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertIn("--ext-content-json", ingest_help.stdout)
        self.assertNotIn("--version", ingest_help.stdout)
        self.assertNotIn("--status-cd", ingest_help.stdout)
        self.assertNotIn("--labels-json", ingest_help.stdout)

        organize_help = subprocess.run(
            ["python3", str(SCRIPT), "organize", "--help"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertIn("--source-object-code", organize_help.stdout)

        update_status_help = subprocess.run(
            ["python3", str(SCRIPT), "update-task-status", "--help"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertIn("--session-id", update_status_help.stdout)
        self.assertIn("--task-status", update_status_help.stdout)
        self.assertIn("{done,failed,mixed}", update_status_help.stdout)


if __name__ == "__main__":
    unittest.main()
