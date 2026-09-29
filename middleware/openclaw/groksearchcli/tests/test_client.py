from __future__ import annotations

import os
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR / "src"))

from groksearchcli.client import XaiSearchClient  # noqa: E402
from groksearchcli.errors import GrokSearchCliError  # noqa: E402


class FakeSdkChat:
    def __init__(self):
        self.created = []

    def create(self, **kwargs):
        self.created.append(kwargs)
        return FakeSdkSession()


class FakeSdkClient:
    def __init__(self):
        self.chat = FakeSdkChat()


class FakeSdkSession:
    def append(self, _message):
        pass

    def stream(self):
        tool = SimpleNamespace(function=SimpleNamespace(
            name="web_search", arguments='{"query":"q","num_results":5}'
        ))
        usage = SimpleNamespace(reasoning_tokens=12)
        response = SimpleNamespace(
            id="sdk-r1", content="sdk answer", citations=["https://example.com"],
            usage=usage, server_side_tool_usage={"SERVER_SIDE_TOOL_WEB_SEARCH": 1},
            tool_calls=[tool],
        )
        yield response, SimpleNamespace(content="", tool_calls=[tool])
        yield response, SimpleNamespace(content="sdk answer", tool_calls=[])


class ClientTests(unittest.TestCase):
    def test_requires_api_key_from_environment(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(GrokSearchCliError) as captured:
                XaiSearchClient(sdk_client=FakeSdkClient())
        self.assertEqual("MISSING_CREDENTIAL", captured.exception.code)

    def test_uses_official_xai_sdk_chat_stream(self):
        sdk = FakeSdkClient()
        events = []
        fake_chat = types.ModuleType("xai_sdk.chat")
        fake_tools = types.ModuleType("xai_sdk.tools")
        fake_chat.system = lambda value: value
        fake_chat.user = lambda value: value
        fake_tools.web_search = lambda **kwargs: kwargs
        fake_tools.x_search = lambda **kwargs: kwargs
        with patch.dict(os.environ, {"XAI_API_KEY": "secret"}, clear=True):
            with patch.dict(sys.modules, {"xai_sdk.chat": fake_chat, "xai_sdk.tools": fake_tools}):
                client = XaiSearchClient(sdk_client=sdk, event_callback=events.append)
                result = client.search({
                    "model": "grok-4.6", "input": "q", "tools": [{"type": "web_search"}],
                }, timeout_seconds=60)
        self.assertEqual("sdk-r1", result["id"])
        message = next(item for item in result["output"] if item["type"] == "message")
        self.assertEqual("sdk answer", message["content"][0]["text"])
        event_types = [event["type"] for event in events]
        self.assertEqual("response.created", event_types[0])
        self.assertIn("response.output_item.added", event_types)
        self.assertIn("response.reasoning_summary_text.delta", event_types)
        self.assertIn("response.output_text.delta", event_types)
        self.assertEqual("response.completed", event_types[-1])
        self.assertEqual("grok-4.6", sdk.chat.created[0]["model"])
        self.assertEqual(1, len(sdk.chat.created[0]["tools"]))


if __name__ == "__main__":
    unittest.main()
