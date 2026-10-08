import asyncio
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch


SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL.parents[1] / "callcli" / "src"))
SPEC = importlib.util.spec_from_file_location("conversation_search", SKILL / "scripts" / "search.py")
search = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(search)


class ConversationSearchTests(unittest.TestCase):
    def test_filters_and_pagination_reach_only_fixed_endpoint(self):
        args = search.parse_args(["--session-id", "current", "--user-code", "target",
                                  "--digital-employee-id", "123", "--keyword", "预算%",
                                  "--start-time", "2026-09-01 00:00:00", "--page-num", "2"])
        data = {"list": [{"askContent": "预算%"}], "total": 21,
                "pageNum": 2, "pageSize": 20, "totalPages": 2}
        client = AsyncMock()
        client.json.return_value = {"code": 0, "data": data}
        result = asyncio.run(search.search(args, client))
        client.json.assert_awaited_once_with(
            "POST", "/byaiService/skills/conversation-search/query", session_id="current",
            payload={"userCode": "target", "digitalEmployeeId": 123, "keyword": "预算%",
                     "startTime": "2026-09-01 00:00:00", "pageNum": 2, "pageSize": 20})
        self.assertEqual(result, {"ok": True, "data": data})

    def test_unfiltered_query_and_single_time_bound(self):
        args = search.parse_args(["--session-id", "current"])
        self.assertEqual(search.payload_for(args), {"pageNum": 1, "pageSize": 20})
        args = search.parse_args(["--session-id", "current", "--end-time", "2026-09-01 00:00:00"])
        self.assertEqual(search.payload_for(args)["endTime"], "2026-09-01 00:00:00")

    def test_rejects_invalid_input_and_identity_or_endpoint_override(self):
        for extra in (["--page-num", "0"], ["--page-size", "101"], ["--keyword", " "],
                      ["--user-code", ""], ["--start-time", "not-a-date"],
                      ["--start-time", "2026-09-02 00:00:00", "--end-time", "2026-09-01 00:00:00"],
                      ["--token", "forged"], ["--caller-user-code", "admin"], ["--endpoint", "https://example.com"]):
            with self.subTest(extra=extra), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                search.parse_args(["--session-id", "current", *extra])

    def test_malformed_or_error_response_is_not_success(self):
        for body in ({"code": -1, "data": {}}, {"data": {}}, {"code": 0, "data": {}},
                     {"code": 0, "data": {"list": []}}):
            client = AsyncMock()
            client.json.return_value = body
            with self.subTest(body=body), self.assertRaises(ValueError):
                asyncio.run(search.search(search.parse_args(["--session-id", "current"]), client))

    def test_missing_token_stops_before_network(self):
        output = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), redirect_stdout(output), \
                patch("callcli.service_client.DiscoveryServiceClient.json", new_callable=AsyncMock) as http:
            self.assertEqual(search.main(["--session-id", "current"]), 1)
            http.assert_not_called()
        self.assertFalse(json.loads(output.getvalue())["ok"])

    def test_denial_is_terminal_and_does_not_echo_credentials_or_backend_data(self):
        from callcli.errors import CallCliError
        output = io.StringIO()
        with patch.dict(os.environ, {"BEYOND_TOKEN": "test-secret"}, clear=True), redirect_stdout(output), \
                patch("callcli.service_client.DiscoveryServiceClient.json", new_callable=AsyncMock) as http:
            http.side_effect = CallCliError("SESSION_INVALID", "test-secret private record")
            self.assertEqual(search.main(["--session-id", "current"]), 1)
            self.assertEqual(http.await_count, 1)
        self.assertFalse(json.loads(output.getvalue())["ok"])
        self.assertNotIn("test-secret", output.getvalue())
        self.assertNotIn("private record", output.getvalue())


if __name__ == "__main__":
    unittest.main()
