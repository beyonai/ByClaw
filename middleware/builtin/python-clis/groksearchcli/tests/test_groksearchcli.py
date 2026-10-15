from __future__ import annotations

import json
import sys
import time
import unittest
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR / "src"))

import groksearchcli.cli as cli_module  # noqa: E402
from groksearchcli.cli import (  # noqa: E402
    _call_with_heartbeat,
    _progress_event,
    build_parser,
    dispatch,
    main,
)
from groksearchcli.errors import GrokSearchCliError  # noqa: E402


class FakeClient:
    def __init__(self, response: dict | None = None) -> None:
        self.calls: list[dict] = []
        self.response = response or {
            "id": "resp_1",
            "model": "grok-4.6",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "answer",
                            "annotations": [
                                {
                                    "type": "url_citation",
                                    "url": "https://example.com/a",
                                    "title": "Example",
                                }
                            ],
                        }
                    ],
                }
            ],
            "usage": {"input_tokens": 10, "output_tokens": 20, "reasoning_tokens": 3},
            "server_side_tool_usage": {"web_search_calls": 2},
        }

    def search(self, request: dict, *, timeout_seconds: float) -> dict:
        self.calls.append({"request": request, "timeout_seconds": timeout_seconds})
        return self.response


class CliContractTests(unittest.TestCase):
    def parse(self, *argv: str):
        return build_parser().parse_args(list(argv))

    def test_web_search_maps_filters_and_image_flags(self):
        args = self.parse(
            "web", "search", "--query", "What is xAI?",
            "--allow-domain", "https://x.ai/",
            "--allow-domain", "docs.x.ai",
            "--image-understanding", "--image-search",
        )
        client = FakeClient()

        result = dispatch(args, client)

        self.assertEqual(
            {
                "model": "grok-4.6",
                "input": "What is xAI?",
                "tools": [{
                    "type": "web_search",
                    "filters": {"allowed_domains": ["x.ai", "docs.x.ai"]},
                    "enable_image_understanding": True,
                    "enable_image_search": True,
                }],
            },
            client.calls[0]["request"],
        )
        self.assertTrue(result["ok"])
        self.assertEqual("groksearch.web.search", result["operation"])
        self.assertEqual("answer", result["data"]["answer"])
        self.assertEqual("https://example.com/a", result["data"]["citations"][0]["url"])

    def test_x_search_maps_handles_dates_and_media_flags(self):
        args = self.parse(
            "x", "search", "--query", "AI discussion",
            "--allow-handle", "@xai", "--allow-handle", "OpenAI",
            "--from-date", "2026-09-01", "--to-date", "2026-09-16",
            "--image-understanding", "--video-understanding",
        )
        client = FakeClient()

        dispatch(args, client)

        self.assertEqual(
            [{
                "type": "x_search",
                "allowed_x_handles": ["xai", "OpenAI"],
                "from_date": "2026-09-01",
                "to_date": "2026-09-16",
                "enable_image_understanding": True,
                "enable_video_understanding": True,
            }],
            client.calls[0]["request"]["tools"],
        )

    def test_research_exposes_both_tools_in_one_request(self):
        args = self.parse(
            "research", "run", "--query", "market report",
            "--allow-domain", "example.com", "--allow-handle", "example",
            "--from-date", "2026-09-01",
        )
        client = FakeClient()

        result = dispatch(args, client)

        self.assertEqual(["web_search", "x_search"], [t["type"] for t in client.calls[0]["request"]["tools"]])
        self.assertEqual("groksearch.research.run", result["operation"])

    def test_rejects_mutually_exclusive_domain_filters_before_call(self):
        args = self.parse(
            "web", "search", "--query", "q",
            "--allow-domain", "x.ai", "--exclude-domain", "example.com",
        )
        client = FakeClient()
        with self.assertRaises(GrokSearchCliError) as captured:
            dispatch(args, client)
        self.assertEqual("INVALID_ARGUMENT", captured.exception.code)
        self.assertEqual([], client.calls)

    def test_rejects_invalid_date_range_before_call(self):
        args = self.parse(
            "x", "search", "--query", "q",
            "--from-date", "2026-09-16", "--to-date", "2026-09-01",
        )
        client = FakeClient()
        with self.assertRaises(GrokSearchCliError):
            dispatch(args, client)
        self.assertEqual([], client.calls)

    def test_limits_domains_and_handles_before_call(self):
        client = FakeClient()
        domains = sum((["--allow-domain", f"d{i}.example"] for i in range(6)), [])
        with self.assertRaises(GrokSearchCliError):
            dispatch(self.parse("web", "search", "--query", "q", *domains), client)
        handles = sum((["--allow-handle", f"user{i}"] for i in range(21)), [])
        with self.assertRaises(GrokSearchCliError):
            dispatch(self.parse("x", "search", "--query", "q", *handles), client)
        self.assertEqual([], client.calls)

    def test_describe_is_local_and_machine_readable(self):
        client = FakeClient()
        result = dispatch(self.parse("describe", "web", "search"), client)
        self.assertEqual("groksearch.describe", result["operation"])
        self.assertEqual("web search", result["data"]["command"])
        self.assertIn("query", result["data"]["input"]["required"])
        self.assertEqual("string", result["data"]["output"]["errorEnvelope"]["error.code"])
        self.assertEqual("string", result["data"]["output"]["dataSchema"]["properties"]["answer"]["type"])
        self.assertIn("EMPTY_RESPONSE", result["data"]["errors"])
        self.assertEqual([], client.calls)

    def test_describe_defines_query_for_agents(self):
        client = FakeClient()
        web = dispatch(self.parse("describe", "web", "search"), client)
        x_search = dispatch(self.parse("describe", "x", "search"), client)
        self.assertIn("自然语言", web["data"]["input"]["properties"]["query"]["description"])
        self.assertIn("自主生成", web["data"]["input"]["properties"]["query"]["description"])
        self.assertIn("X 内容", x_search["data"]["input"]["properties"]["query"]["description"])
        self.assertTrue(web["data"]["input"]["properties"]["query"]["examples"])

    def test_rejects_non_canonical_dates_unicode_handles_and_invalid_domains(self):
        client = FakeClient()
        invalid_commands = [
            ("x", "search", "--query", "q", "--from-date", "20260916"),
            ("x", "search", "--query", "q", "--allow-handle", "用户"),
            ("web", "search", "--query", "q", "--allow-domain", "example.com:bad"),
        ]
        for command in invalid_commands:
            with self.subTest(command=command), self.assertRaises(GrokSearchCliError):
                dispatch(self.parse(*command), client)
        self.assertEqual([], client.calls)

    def test_rejects_incomplete_response(self):
        client = FakeClient({
            "id": "r1", "status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"},
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "partial"}]}],
        })
        with self.assertRaises(GrokSearchCliError) as captured:
            dispatch(self.parse("web", "search", "--query", "q"), client)
        self.assertEqual("INCOMPLETE_RESPONSE", captured.exception.code)

    def test_normalizes_top_level_citations_markdown_images_and_sdk_tool_usage(self):
        client = FakeClient({
            "id": "r1", "model": "grok-4.6", "status": "completed",
            "citations": ["https://x.com/example/status/1", "https://example.com/a"],
            "output": [
                {"type": "web_search_call", "id": "w1", "status": "completed"},
                {"type": "message", "content": [{
                    "type": "output_text", "text": "Answer\n![Launch](https://img.example/launch.jpg)",
                    "annotations": [],
                }]},
            ],
            "usage": {"input_tokens": 1, "output_tokens": 2, "num_server_side_tools_used": 1},
        })
        result = dispatch(self.parse("web", "search", "--query", "q"), client)
        self.assertEqual(2, len(result["data"]["citations"]))
        self.assertEqual("x", result["data"]["citations"][0]["sourceType"])
        self.assertEqual("https://img.example/launch.jpg", result["data"]["images"][0]["url"])
        self.assertEqual(1, result["meta"]["toolUsage"]["totalServerSideToolsUsed"])
        self.assertEqual(1, result["meta"]["toolUsage"]["webSearchCalls"])

    def test_main_returns_structured_error_for_invalid_arguments(self):
        from contextlib import redirect_stdout
        from io import StringIO

        output = StringIO()
        with redirect_stdout(output):
            exit_code = main(["web", "search"])
        payload = json.loads(output.getvalue())
        self.assertEqual(2, exit_code)
        self.assertFalse(payload["ok"])
        self.assertEqual("INVALID_ARGUMENT", payload["error"]["code"])

    def test_heartbeat_keeps_silent_request_observable_on_stderr(self):
        from contextlib import redirect_stderr
        from io import StringIO

        output = StringIO()

        def slow_call():
            time.sleep(0.03)
            return {"id": "done"}

        with redirect_stderr(output):
            result = _call_with_heartbeat(slow_call, interval_seconds=0.005)
        self.assertEqual("done", result["id"])
        heartbeat = json.loads(output.getvalue().splitlines()[0])
        self.assertEqual("groksearch.status", heartbeat["event"])
        self.assertEqual("working", heartbeat["phase"])
        self.assertEqual("检索仍在进行", heartbeat["message"])
        self.assertIn("elapsedSeconds", heartbeat)

    def test_stream_events_are_presented_as_business_statuses(self):
        from contextlib import redirect_stderr
        from io import StringIO
        from unittest.mock import patch

        output = StringIO()
        cli_module._LAST_PROGRESS_AT = 0.0
        with patch("groksearchcli.cli.time.monotonic", side_effect=[10.0, 16.0, 22.0, 28.0]), \
                redirect_stderr(output):
            _progress_event({"type": "response.created"})
            _progress_event({"type": "response.reasoning_summary_text.delta"})
            _progress_event({"type": "response.output_text.delta"})
            _progress_event({"type": "response.completed"})

        statuses = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(
            ["started", "planning", "writing", "completed"],
            [status["phase"] for status in statuses],
        )
        self.assertEqual("检索请求已提交", statuses[0]["message"])
        self.assertEqual("正在分析检索任务", statuses[1]["message"])
        self.assertEqual("正在整理检索结果", statuses[2]["message"])
        self.assertEqual("检索完成", statuses[3]["message"])
        self.assertNotIn("type", statuses[0])

    def test_verbose_progress_shows_reasoning_and_tool_arguments(self):
        from contextlib import redirect_stderr
        from io import StringIO

        output = StringIO()
        with redirect_stderr(output):
            _progress_event({"type": "response.created"}, verbose=True)
            _progress_event({"type": "response.reasoning_summary_text.delta"}, verbose=True)
            _progress_event({
                "type": "response.output_item.added",
                "item": {
                    "type": "web_search_call",
                    "action": {"type": "search", "query": "本体 资源", "num_results": 15},
                },
            }, verbose=True)
            _progress_event({"type": "response.output_text.delta"}, verbose=True)

        text = output.getvalue()
        self.assertIn("Thinking...", text)
        self.assertIn("Calling tool: web_search", text)
        self.assertIn('"query":"本体 资源"', text)
        self.assertIn("Generating final response...", text)

    def test_verbose_progress_preserves_sdk_tool_name(self):
        from contextlib import redirect_stderr
        from io import StringIO

        output = StringIO()
        with redirect_stderr(output):
            _progress_event({
                "type": "response.output_item.added",
                "item": {
                    "type": "web_search_call",
                    "tool_name": "open_page",
                    "action": {"url": "https://example.com"},
                },
            }, verbose=True)
        self.assertIn("Calling tool: open_page", output.getvalue())

    def test_verbose_is_available_on_search_commands(self):
        args = self.parse("web", "search", "--query", "q", "--verbose")
        self.assertTrue(args.verbose)


if __name__ == "__main__":
    unittest.main()
