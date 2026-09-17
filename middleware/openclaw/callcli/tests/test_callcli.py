from __future__ import annotations

import io
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from callcli.capability import build_capability
from callcli.cli import _request, build_parser, main
from callcli.credentials import runtime_headers
from callcli.errors import CallCliError
from callcli.executors import AgentExecutor, McpExecutor, ToolExecutor, ToolkitExecutor
from callcli.resource_catalog import ResourceCatalog
from callcli.runtime import CapabilityRuntime
from callcli.service_client import DiscoveryServiceClient
from callcli.snapshot import RedisSnapshotProvider


class FakeCatalogClient:
    def __init__(self, pages: list[dict]) -> None:
        self.pages = pages
        self.calls: list[tuple[str, str, dict]] = []

    async def json(self, method: str, path: str, *, session_id: str, payload: dict) -> dict:
        self.calls.append((method, path, payload))
        return self.pages[min(payload["pageNum"] - 1, len(self.pages) - 1)]


class FakeProvider:
    def __init__(self, raw: dict) -> None:
        self.raw = raw

    async def resolve(self, resource_id: str, resource_type: str) -> dict:
        return self.raw


class ResourceCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_pages_fetches_each_page_once(self) -> None:
        def page(number: int, resource_id: str) -> dict:
            return {
                "code": 0, "success": True, "msg": "ok",
                "data": {
                    "list": [{
                        "resourceId": resource_id, "resourceBizType": "MCP",
                        "resourceType": "ATOM", "resourceName": resource_id,
                        "authStatus": "passed",
                    }],
                    "pageNum": number, "pageSize": 1, "total": 2, "totalPages": 2,
                },
            }

        client = FakeCatalogClient([page(1, "one"), page(2, "two")])
        result = await ResourceCatalog(client).list_resources(
            session_id="s1", page_size=1, all_pages=True
        )
        self.assertEqual([item["resourceId"] for item in result["items"]], ["one", "two"])
        self.assertEqual([call[2]["pageNum"] for call in client.calls], [1, 2])

    async def test_list_uses_fixed_authorization_contract_and_routes_by_biz_type(self) -> None:
        client = FakeCatalogClient([{
            "code": 0,
            "success": True,
            "msg": "ok",
            "data": {
                "list": [{
                    "resourceId": 10001683,
                    "resourceBizType": "AGENT",
                    "resourceType": "ATOM",
                    "resourceName": "agent",
                    "authStatus": "passed",
                    "hasPermission": False,
                }],
                "pageNum": 1,
                "pageSize": 30,
                "total": 1,
                "totalPages": 1,
            },
        }])
        result = await ResourceCatalog(client).list_resources(session_id="s1")
        self.assertEqual(result["items"][0]["resourceId"], "10001683")
        self.assertEqual(result["items"][0]["routeType"], "AGENT")
        self.assertEqual(result["items"][0]["resourceType"], "ATOM")
        self.assertEqual(client.calls[0][1], "/byaiService/auth/privilegeGrant/listResourceUseAuth")
        self.assertEqual(client.calls[0][2]["resourceBizTypeList"], ["MCP", "TOOLKIT", "AGENT"])

    async def test_find_authorized_requires_exact_id_and_type(self) -> None:
        client = FakeCatalogClient([{
            "code": 0, "success": True,
            "data": {"list": [{
                "resourceId": "7", "resourceBizType": "MCP", "resourceType": "ATOM",
                "resourceName": "m", "authStatus": "passed",
            }], "pageNum": 1, "pageSize": 30, "total": 1, "totalPages": 1},
        }])
        item = await ResourceCatalog(client).find_authorized("s1", "7", "MCP")
        self.assertEqual(item["resourceId"], "7")
        with self.assertRaisesRegex(CallCliError, "type") as caught:
            await ResourceCatalog(client).find_authorized("s1", "7", "AGENT")
        self.assertEqual(caught.exception.code, "RESOURCE_TYPE_MISMATCH")


class CapabilityTests(unittest.TestCase):
    def test_builds_toolkit_actions_from_openapi_snapshot(self) -> None:
        raw = {
            "resourceId": "8", "resourceBizType": "TOOLKIT", "resourceName": "orders",
            "domainURL": "https://example.test", "headers": {"X-App": "one"},
            "pluginMachineInfo": [{"pluginMachineOpenAPI": {
                "paths": {"/orders/search": {"post": {
                    "operationId": "search_orders", "description": "search",
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object", "required": ["keyword"],
                        "properties": {"keyword": {"type": "string"}},
                    }}}},
                }}},
            }}],
        }
        cap = build_capability(raw, "8", "TOOLKIT")
        self.assertEqual(cap["actions"][0]["name"], "search_orders")
        self.assertEqual(cap["actions"][0]["url"], "https://example.test/orders/search")
        self.assertIn("keyword", cap["actions"][0]["inputSchema"]["required"])

    def test_rejects_unsupported_and_mismatched_resources(self) -> None:
        with self.assertRaises(CallCliError) as caught:
            build_capability({"resourceId": "1", "resourceBizType": "DOC"}, "1", "DOC")
        self.assertEqual(caught.exception.code, "UNSUPPORTED_RESOURCE_TYPE")
        with self.assertRaises(CallCliError) as caught:
            build_capability({"resourceId": "1", "resourceBizType": "MCP"}, "1", "AGENT")
        self.assertEqual(caught.exception.code, "RESOURCE_TYPE_MISMATCH")

    def test_builds_form_toolkit_input_and_output_schemas(self) -> None:
        input_schema = {
            "type": "object", "required": ["day"],
            "properties": {"day": {"type": "string", "description": "yyyyMMdd"}},
        }
        output_schema = {
            "type": "object", "properties": {"holiday": {"type": "string"}},
        }
        raw = {
            "resourceId": "11214412", "resourceBizType": "TOOLKIT",
            "domainURL": "http://tool.test", "pluginMachineInfo": [{
                "pluginMachineOpenAPI": {
                    "paths": {"/holiday": {"post": {
                        "operationId": "searchHoliday",
                        "requestBody": {"required": True, "content": {
                            "application/x-www-form-urlencoded": {"schema": input_schema},
                        }},
                        "responses": {"200": {"content": {
                            "application/json": {"schema": output_schema},
                        }}},
                    }}},
                },
            }],
        }
        action = build_capability(raw, "11214412", "TOOLKIT")["actions"][0]
        self.assertEqual(action["inputSchema"], input_schema)
        self.assertEqual(action["outputSchema"], output_schema)
        self.assertEqual(action["requestContentType"], "application/x-www-form-urlencoded")


class ExecutorTests(unittest.IsolatedAsyncioTestCase):
    async def test_mcp_discover_initializes_and_lists_tools(self) -> None:
        methods: list[str] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            methods.append(payload["method"])
            if payload["method"] == "initialize":
                return httpx.Response(200, headers={"Mcp-Session-Id": "discover-1"},
                                      json={"jsonrpc": "2.0", "id": 1, "result": {}})
            if payload["method"] == "notifications/initialized":
                return httpx.Response(202)
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 2, "result": {
                "tools": [{"name": "bing_search", "description": "search",
                           "inputSchema": {"type": "object"}}]}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        cap = {"id": "3", "type": "MCP", "serverUrl": "https://mcp.test/rpc",
               "transferType": "streamable_http", "headers": {}}
        tools = await McpExecutor(client).discover(cap, {"sessionId": "s"})
        self.assertEqual(tools[0]["name"], "bing_search")
        self.assertEqual(methods, ["initialize", "notifications/initialized", "tools/list"])
        await client.aclose()

    async def test_a2a_reads_agent_card_then_streams_json_rpc(self) -> None:
        seen: list[tuple[str, str]] = []
        stream = (
            'data: {"jsonrpc":"2.0","result":{"kind":"artifact-update",'
            '"artifact":{"parts":[{"kind":"text","text":"完成"}]}}}\n\n'
        )

        async def handler(request: httpx.Request) -> httpx.Response:
            seen.append((request.method, str(request.url)))
            if request.method == "GET":
                return httpx.Response(200, json={"url": "https://agent.test/rpc"})
            payload = json.loads(request.content)
            self.assertEqual(payload["method"], "message/stream")
            self.assertEqual(payload["params"]["message"]["parts"][0]["text"], "执行任务")
            return httpx.Response(200, text=stream, headers={"content-type": "text/event-stream"})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        cap = {"id": "5", "type": "AGENT", "integrationType": "A2A",
               "sseUrl": "https://agent.test/card", "headers": {}}
        result = await AgentExecutor(client).execute(cap, "执行任务", {}, {"sessionId": "s"})
        self.assertEqual(result, {"text": "完成"})
        self.assertEqual(seen, [("GET", "https://agent.test/card"),
                                ("POST", "https://agent.test/rpc")])
        await client.aclose()

    async def test_tool_validates_schema_and_posts_json(self) -> None:
        seen: dict = {}

        async def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"value": 2})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        cap = {"id": "1", "type": "TOOL", "url": "https://tool.test/run", "headers": {},
               "inputSchema": {"type": "object", "required": ["x"],
                               "properties": {"x": {"type": "integer"}},
                               "additionalProperties": False}}
        result = await ToolExecutor(client).execute(cap, {"x": 2}, {})
        self.assertEqual(result, {"value": 2})
        self.assertEqual(seen["body"], {"x": 2})
        with self.assertRaises(CallCliError) as caught:
            await ToolExecutor(client).execute(cap, {"x": "bad"}, {})
        self.assertEqual(caught.exception.code, "INVALID_PARAMETERS")
        await client.aclose()

    async def test_toolkit_requires_exact_action(self) -> None:
        client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"ok": True})
        ))
        cap = {"id": "2", "type": "TOOLKIT", "headers": {}, "actions": [
            {"name": "search", "url": "https://tool.test/search", "method": "POST",
             "headers": {}, "inputSchema": {"type": "object"}},
            {"name": "search_all", "url": "https://tool.test/all", "method": "POST",
             "headers": {}, "inputSchema": {"type": "object"}},
        ]}
        with self.assertRaises(CallCliError) as caught:
            await ToolkitExecutor(client).execute(cap, "sea", {}, {})
        self.assertEqual(caught.exception.code, "ACTION_NOT_FOUND")
        result = await ToolkitExecutor(client).execute(cap, "search", {}, {})
        self.assertTrue(result["ok"])
        await client.aclose()

    async def test_toolkit_sends_urlencoded_form_arguments(self) -> None:
        seen: dict = {}

        async def handler(request: httpx.Request) -> httpx.Response:
            seen["content_type"] = request.headers.get("content-type")
            seen["body"] = request.content.decode()
            return httpx.Response(200, json={"holiday": "中秋节"})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        cap = {"id": "2", "type": "TOOLKIT", "headers": {}, "actions": [{
            "name": "searchHoliday", "url": "https://tool.test/holiday", "method": "POST",
            "headers": {}, "requestContentType": "application/x-www-form-urlencoded",
            "inputSchema": {"type": "object", "required": ["day"],
                            "properties": {"day": {"type": "string"}}},
        }]}
        result = await ToolkitExecutor(client).execute(
            cap, "searchHoliday", {"day": "20260925"}, {}
        )
        self.assertEqual(result["holiday"], "中秋节")
        self.assertTrue(seen["content_type"].startswith("application/x-www-form-urlencoded"))
        self.assertEqual(seen["body"], "day=20260925")
        await client.aclose()

    async def test_toolkit_does_not_implicitly_select_its_only_action(self) -> None:
        client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"ok": True})
        ))
        cap = {"id": "2", "type": "TOOLKIT", "headers": {}, "actions": [
            {"name": "holiday", "url": "https://tool.test/holiday", "method": "POST",
             "headers": {}, "inputSchema": {"type": "object"}},
        ]}
        with self.assertRaises(CallCliError) as caught:
            await ToolkitExecutor(client).execute(cap, "", {}, {})
        self.assertEqual(caught.exception.code, "ACTION_REQUIRED")
        await client.aclose()

    async def test_mcp_reuses_session_for_list_and_call(self) -> None:
        calls: list[tuple[str, str | None]] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            calls.append((payload["method"], request.headers.get("Mcp-Session-Id")))
            if payload["method"] == "initialize":
                return httpx.Response(200, headers={"Mcp-Session-Id": "mcp-1"},
                                      json={"jsonrpc": "2.0", "id": 1, "result": {}})
            if payload["method"] == "notifications/initialized":
                return httpx.Response(202, text="")
            if payload["method"] == "tools/list":
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": 2, "result": {
                    "tools": [{"name": "search", "inputSchema": {"type": "object"}}]}})
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 3,
                                             "result": {"content": [{"type": "text", "text": "ok"}]}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        cap = {"id": "3", "type": "MCP", "serverUrl": "https://mcp.test/rpc",
               "transferType": "streamable_http", "headers": {}}
        result = await McpExecutor(client).execute(cap, "search", {}, {})
        self.assertEqual(result["content"][0]["text"], "ok")
        self.assertEqual(calls, [
            ("initialize", None), ("notifications/initialized", "mcp-1"),
            ("tools/list", "mcp-1"), ("tools/call", "mcp-1"),
        ])
        await client.aclose()

    async def test_mcp_does_not_implicitly_call_its_only_tool(self) -> None:
        methods: list[str] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            methods.append(payload["method"])
            if payload["method"] == "initialize":
                return httpx.Response(200, headers={"Mcp-Session-Id": "mcp-1"},
                                      json={"jsonrpc": "2.0", "id": 1, "result": {}})
            if payload["method"] == "notifications/initialized":
                return httpx.Response(202)
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 2, "result": {
                "tools": [{"name": "search", "inputSchema": {"type": "object"}}]}})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        cap = {"id": "3", "type": "MCP", "serverUrl": "https://mcp.test/rpc",
               "transferType": "streamable_http", "headers": {}}
        with self.assertRaises(CallCliError) as caught:
            await McpExecutor(client).execute(cap, "", {}, {})
        self.assertEqual(caught.exception.code, "ACTION_REQUIRED")
        self.assertEqual(methods, ["initialize", "notifications/initialized", "tools/list"])
        await client.aclose()

    async def test_mcp_falls_back_to_legacy_sse_on_streamable_method_not_allowed(self) -> None:
        requests: list[tuple[str, str]] = []
        legacy_stream = (
            "event: endpoint\ndata: /messages\n\n"
            'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'
            'data: {"jsonrpc":"2.0","id":2,"result":{"tools":['
            '{"name":"bing_search","inputSchema":{"type":"object"}}]}}\n\n'
            'data: {"jsonrpc":"2.0","id":3,"result":{"content":['
            '{"type":"text","text":"found"}]}}\n\n'
        )

        async def handler(request: httpx.Request) -> httpx.Response:
            requests.append((request.method, request.url.path))
            if request.method == "POST" and request.url.path.endswith("/mcp"):
                return httpx.Response(405, text="Method Not Allowed")
            if request.method == "GET":
                return httpx.Response(200, text=legacy_stream,
                                      headers={"content-type": "text/event-stream"})
            return httpx.Response(202)

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        cap = {"id": "3", "type": "MCP", "serverUrl": "https://mcp.test/mcp",
               "transferType": "streamable_http", "headers": {}}
        result = await McpExecutor(client).execute(cap, "bing_search", {}, {"sessionId": "s"})
        self.assertEqual(result["content"][0]["text"], "found")
        self.assertIn(("GET", "/mcp"), requests)
        self.assertIn(("POST", "/messages"), requests)
        await client.aclose()

    async def test_agent_parses_sse_and_rejects_ask_personal(self) -> None:
        stream = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' \
                 'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' \
                 'data: [DONE]\n\n'
        client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, text=stream, headers={"content-type": "text/event-stream"})
        ))
        cap = {"id": "4", "type": "AGENT", "integrationType": "INTERFACE",
               "sseUrl": "https://agent.test/chat", "headers": {}}
        result = await AgentExecutor(client).execute(cap, "问候", {}, {"sessionId": "s"})
        self.assertEqual(result["text"], "你好")
        cap["implType"] = "ASK_PERSONAL"
        with self.assertRaises(CallCliError) as caught:
            await AgentExecutor(client).execute(cap, "x", {}, {"sessionId": "s"})
        self.assertEqual(caught.exception.code, "UNSUPPORTED_LOCAL_AGENT")
        await client.aclose()

    async def test_agent_with_home_url_is_not_page_without_page_integration_type(self) -> None:
        stream = 'data: {"choices":[{"delta":{"content":"正常调用"}}]}\n\n' \
                 'data: [DONE]\n\n'
        client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, text=stream, headers={"content-type": "text/event-stream"}
            )
        ))
        cap = {
            "id": "6", "type": "AGENT", "integrationType": "INTERFACE",
            "sseUrl": "https://agent.test/chat",
            "homeUrl": "https://agent.test/home", "headers": {},
        }
        result = await AgentExecutor(client).execute(cap, "执行", {}, {"sessionId": "s"})
        self.assertEqual(result["text"], "正常调用")
        await client.aclose()


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_describe_mcp_enriches_snapshot_with_live_tools(self) -> None:
        catalog = AsyncMock()
        executor = AsyncMock()
        executor.describe.return_value = [{"name": "bing_search", "inputSchema": {"type": "object"}}]
        raw = {"resourceId": "3", "resourceBizType": "MCP", "mcpServerUrl": "https://mcp.test"}
        runtime = CapabilityRuntime(catalog, FakeProvider(raw), executor)
        result = await runtime.describe("s", "3", "MCP")
        self.assertEqual(result["tools"][0]["name"], "bing_search")
        executor.describe.assert_awaited_once()

    async def test_runtime_reauthorizes_then_executes(self) -> None:
        catalog = AsyncMock()
        catalog.find_authorized.return_value = {"resourceId": "1", "routeType": "TOOL"}
        executor = AsyncMock()
        executor.execute.return_value = {"answer": 42}
        runtime = CapabilityRuntime(catalog, FakeProvider({"resourceId": "1", "resourceBizType": "TOOL"}), executor)
        result = await runtime.invoke("s", "1", "TOOL", arguments={"x": 1})
        self.assertEqual(result["data"], {"answer": 42})
        catalog.find_authorized.assert_awaited_once_with("s", "1", "TOOL")


class SnapshotTests(unittest.IsolatedAsyncioTestCase):
    async def test_file_snapshot_uses_exact_type_and_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "MCP_17.json"
            path.write_text(json.dumps({"resourceId": "17", "resourceBizType": "MCP"}),
                            encoding="utf-8")
            provider = RedisSnapshotProvider(Path(directory))
            result = await provider.resolve("17", "MCP")
            self.assertEqual(result["resourceId"], "17")
            with self.assertRaises(CallCliError) as caught:
                await provider.resolve("17", "AGENT")
            self.assertEqual(caught.exception.code, "RESOURCE_DETAILS_NOT_FOUND")


class CredentialTests(unittest.TestCase):
    def test_runtime_headers_include_mcp_user_identity_and_protect_runtime_auth(self) -> None:
        env = {"BEYOND_TOKEN": "runtime-beyond", "USER_CODE": "admin",
               "SYSTEM_CODE": "BYAI"}
        with patch.dict(os.environ, env, clear=True):
            headers = runtime_headers("session-1", {"Beyond-Token": "snapshot-token"})
        self.assertEqual(headers["Beyond-Token"], "runtime-beyond")
        self.assertEqual(headers["X-User-Id"], "admin")
        self.assertEqual(headers["x-session-id"], "session-1")

    def test_runtime_headers_accept_platform_beyond_token_environment_name(self) -> None:
        with patch.dict(os.environ, {"Beyond-Token": "platform-token"}, clear=True):
            headers = runtime_headers("session-1")
        self.assertEqual(headers["Beyond-Token"], "platform-token")


class ServiceDiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_uses_framework_discovery_and_runtime_session(self) -> None:
        calls: dict = {}

        class RedisConfig:
            def __init__(self, **kwargs):
                calls["redis"] = kwargs

        def init_redis(*, config):
            calls["initialized"] = config

        class DiscoveryClient:
            def __init__(self, *, cache_interval):
                calls["cacheInterval"] = cache_interval

            async def close(self):
                calls["closed"] = True

        class RetryConfig:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            @classmethod
            def no_retry(cls):
                return cls(max_attempts=1)

        class ByHttpClient:
            def __init__(self, *args, **kwargs):
                calls["baseClient"] = (args, kwargs)

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

        response = types.SimpleNamespace(
            is_success=True, status_code=200,
            data={"code": 0, "success": True, "msg": "ok", "data": {"list": []}},
        )

        class HttpClient:
            async def post(self, service, path, **kwargs):
                calls["post"] = (service, path, kwargs)
                return response

        class AsyncContext:
            async def __aenter__(self):
                return HttpClient()

            async def __aexit__(self, *_args):
                return None

        modules = {
            name: types.ModuleType(name) for name in (
                "by_framework", "by_framework.common", "by_framework.common.config",
                "by_framework.common.redis_client", "by_framework.core",
                "by_framework.core.discovery", "by_framework.util",
                "by_framework.util.discovery_http_client", "by_framework.util.http_client",
            )
        }
        modules["by_framework.common.config"].RedisConfig = RedisConfig
        modules["by_framework.common.redis_client"].init_redis = init_redis
        modules["by_framework.core.discovery"].DiscoveryClient = DiscoveryClient
        modules["by_framework.util.discovery_http_client"].DiscoveryHttpClient = \
            lambda *_args, **_kwargs: AsyncContext()
        modules["by_framework.util.http_client"].ByHttpClient = ByHttpClient
        modules["by_framework.util.http_client"].RetryConfig = RetryConfig
        env = {"CALLCLI_RESOURCE_SERVICE": "ByaiService", "BEYOND_TOKEN": "runtime-token",
               "SYSTEM_CODE": "BYAI", "REDIS_HOST": "redis.internal"}
        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, modules))
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            result = await DiscoveryServiceClient().json(
                "POST", "/byaiService/auth/privilegeGrant/listResourceUseAuth",
                session_id="session-1", payload={"pageNum": 1},
            )
        self.assertEqual(result["code"], 0)
        service, path, kwargs = calls["post"]
        self.assertEqual(service, "ByaiService")
        self.assertEqual(path, "/byaiService/auth/privilegeGrant/listResourceUseAuth")
        self.assertEqual(kwargs["headers"]["x-session-id"], "session-1")
        self.assertEqual(kwargs["headers"]["Beyond-Token"], "runtime-token")
        self.assertNotIn("endpoint", kwargs)
        self.assertTrue(calls["closed"])


class CliTests(unittest.TestCase):
    def test_describe_is_local_json(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            code = main(["describe", "invoke", "--format", "json"])
        payload = json.loads(output.getvalue())
        self.assertEqual(code, 0)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["operation"], "capability.describe")
        self.assertIn("resource describe", payload["data"]["preconditions"][0])

    def test_invalid_arguments_are_json_with_exit_two(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            code = main(["invoke"])
        payload = json.loads(output.getvalue())
        self.assertEqual(code, 2)
        self.assertEqual(payload["error"]["code"], "INVALID_ARGUMENT")

    def test_toolkit_rejects_query_and_requires_explicit_action(self) -> None:
        args = build_parser().parse_args([
            "invoke", "--session-id", "s", "--resource-id", "1",
            "--resource-type", "TOOLKIT", "--query", "9月25号",
        ])
        with self.assertRaises(CallCliError) as caught:
            _request(args)
        self.assertEqual(caught.exception.code, "INVALID_ARGUMENT")
        self.assertIn("query", caught.exception.message)

        args = build_parser().parse_args([
            "invoke", "--session-id", "s", "--resource-id", "1",
            "--resource-type", "TOOLKIT", "--arguments", '{"day":"20260925"}',
        ])
        with self.assertRaises(CallCliError) as caught:
            _request(args)
        self.assertEqual(caught.exception.code, "ACTION_REQUIRED")
        self.assertIn("resource describe", caught.exception.message)


class ExampleSkillTests(unittest.TestCase):
    def test_tool_collection_script_describes_before_invoke(self) -> None:
        script = Path(__file__).parents[1] / "examples/invoke-baiying-capability/scripts/run.py"
        spec = importlib.util.spec_from_file_location("example_capability_skill", script)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        module.RESOURCE_ID = "10001"
        module.RESOURCE_TYPE = "MCP"
        module.ACTION = "search"
        describe = types.SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"ok": True, "data": {"tools": [{
                "name": "search", "inputSchema": {"type": "object"},
            }]}}), stderr="",
        )
        invoke = types.SimpleNamespace(
            returncode=0, stdout=json.dumps({"ok": True, "data": {"answer": "ok"}}), stderr="",
        )
        output = io.StringIO()
        with patch.object(module.subprocess, "run", side_effect=[describe, invoke]) as run:
            with redirect_stdout(output):
                code = module.main(["run.py", "session-1", "hello"])
        self.assertEqual(code, 0)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].args[0][1:3], ["resource", "describe"])
        self.assertEqual(run.call_args_list[1].args[0][1], "invoke")

    def test_tool_collection_script_stops_when_action_is_not_described(self) -> None:
        script = Path(__file__).parents[1] / "examples/invoke-baiying-capability/scripts/run.py"
        spec = importlib.util.spec_from_file_location("example_capability_skill_missing", script)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        module.RESOURCE_ID = "10001"
        module.RESOURCE_TYPE = "TOOLKIT"
        module.ACTION = "missing"
        describe = types.SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"ok": True, "data": {"actions": [{"name": "available"}]}}),
            stderr="",
        )
        with patch.object(module.subprocess, "run", return_value=describe) as run:
            with redirect_stdout(io.StringIO()):
                code = module.main(["run.py", "session-1", "hello"])
        self.assertEqual(code, 4)
        self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
