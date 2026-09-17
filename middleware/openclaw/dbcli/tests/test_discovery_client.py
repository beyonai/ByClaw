from __future__ import annotations

import asyncio
import copy
import os
import sys
import types
import unittest
from contextlib import ExitStack
from unittest.mock import patch


PROJECT_DIR = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(PROJECT_DIR, "src"))

from dbcli.discovery_client import DiscoveryClient  # noqa: E402
from dbcli.errors import DbCliError  # noqa: E402


RESOLUTION = {
    "resolutionId": "resolution-1",
    "driver": "sqlite",
    "database": ":memory:",
    "credential": {"type": "none"},
    "policy": {"allowedOperations": ["SELECT"]},
    "schemaVersion": "test/1",
}

SESSION_RESOURCE = {
    "resourceType": "data_source",
    "resourceId": "3001",
    "datasourceId": "3001",
    "datasourceName": "finance-core",
    "datasourceType": "opengauss",
    "connectionConfig": {
        "host": "database.internal",
        "port": "5432",
        "database": "analytics",
        "username": "report_user",
        "schema": "finance",
        "sslMode": "require",
    },
    "credentials": {"password": "secret-password"},
    "hasPassword": True,
}


class _AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *_args):
        return None


class DiscoveryFrameworkTests(unittest.TestCase):
    def framework_modules(self, response_body=None, *, status_code=200):
        calls = {}
        body = response_body or {
            "code": "0",
            "data": {"items": [SESSION_RESOURCE], "total": "1", "pageNum": "1", "pageSize": "1"},
        }

        class RedisConfig:
            def __init__(self, **kwargs):
                calls["redis_config"] = kwargs

        def init_redis(*, config):
            calls["redis_initialized"] = config

        class FrameworkDiscoveryClient:
            def __init__(self, *, cache_interval):
                calls["cache_interval"] = cache_interval

            async def close(self):
                calls["closed"] = True

        class RetryConfig:
            def __init__(self, **kwargs):
                calls.setdefault("retry", kwargs)
                self.max_attempts = kwargs.get("max_attempts", 3)

            @classmethod
            def no_retry(cls):
                return cls(max_attempts=1, retry_on_status_codes=frozenset())

        class ByHttpClient:
            def __init__(self, base_url, *, timeout, retry_config=None):
                calls["http"] = (base_url, timeout)
                calls["http_retry"] = retry_config

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

        response = types.SimpleNamespace(
            is_success=200 <= status_code < 300,
            status_code=status_code,
            data=body,
        )

        class HttpClient:
            async def post(self, service_name, path, *, headers, json):
                calls["post"] = (service_name, path, headers, json)
                return response

        def discovery_http_client(*args, **kwargs):
            calls["discovery_http"] = kwargs
            return _AsyncContext(HttpClient())

        modules = {
            "by_framework": types.ModuleType("by_framework"),
            "by_framework.common": types.ModuleType("by_framework.common"),
            "by_framework.common.config": types.ModuleType("by_framework.common.config"),
            "by_framework.common.redis_client": types.ModuleType("by_framework.common.redis_client"),
            "by_framework.core": types.ModuleType("by_framework.core"),
            "by_framework.core.discovery": types.ModuleType("by_framework.core.discovery"),
            "by_framework.util": types.ModuleType("by_framework.util"),
            "by_framework.util.discovery_http_client": types.ModuleType(
                "by_framework.util.discovery_http_client"
            ),
            "by_framework.util.http_client": types.ModuleType("by_framework.util.http_client"),
        }
        modules["by_framework.common.config"].RedisConfig = RedisConfig
        modules["by_framework.common.redis_client"].init_redis = init_redis
        modules["by_framework.core.discovery"].DiscoveryClient = FrameworkDiscoveryClient
        modules["by_framework.util.discovery_http_client"].DiscoveryHttpClient = (
            discovery_http_client
        )
        modules["by_framework.util.http_client"].ByHttpClient = ByHttpClient
        modules["by_framework.util.http_client"].RetryConfig = RetryConfig
        return modules, calls

    def test_resolve_uses_by_framework_discovery_and_reference_redis_precedence(self):
        modules, calls = self.framework_modules()
        env = {
            "DBCLI_DATASOURCE_SERVICE": "datasource-service",
            "DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST": "redis-a:7001,redis-b",
            "REDIS_CLUSTER_HOST": "ignored:7000",
            "BEYOND_TOKEN": "secret-token",
            "SYSTEM_CODE": "system-1",
        }
        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, modules))
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            resolved = DiscoveryClient().resolve("session-1", "3001", "metadata")

        self.assertEqual("3001", resolved.resolution_id)
        self.assertEqual("opengauss", resolved.driver)
        self.assertEqual("database.internal:5432", resolved.endpoint)
        self.assertEqual("analytics", resolved.database)
        self.assertEqual("report_user", resolved.credential["username"])
        self.assertEqual("secret-password", resolved.credential["password"])
        self.assertEqual("require", resolved.options["sslmode"])
        self.assertEqual([("redis-a", 7001), ("redis-b", 6379)], calls["redis_config"]["cluster_nodes"])
        self.assertEqual("cluster", calls["redis_config"]["mode"])
        service, path, headers, payload = calls["post"]
        self.assertEqual("datasource-service", service)
        self.assertEqual("/byaiService/open/api/v1/sessionResources/query", path)
        self.assertEqual("secret-token", headers["Beyond-Token"])
        self.assertEqual("system-1", headers["system-code"])
        self.assertEqual("session-1", payload["sessionId"])
        self.assertEqual("data_source", payload["resourceType"])
        self.assertEqual("3001", payload["resourceId"])
        self.assertIs(payload["includeCredentials"], True)
        self.assertEqual(1, payload["pageNum"])
        self.assertEqual(1, payload["pageSize"])
        self.assertNotIn("datasourceCode", payload)
        self.assertNotIn("purpose", payload)
        self.assertEqual(3, calls["retry"]["max_attempts"])
        self.assertEqual(1, calls["http_retry"].max_attempts)
        self.assertTrue(calls["closed"])

    def test_business_failure_is_a_structured_discovery_error(self):
        modules, _calls = self.framework_modules({"code": 40301, "msg": "session denied"})
        with patch.dict(sys.modules, modules), patch.dict(
            os.environ, {"DBCLI_DATASOURCE_SERVICE": "datasource-service"}, clear=True
        ):
            with self.assertRaises(DbCliError) as captured:
                DiscoveryClient().resolve("session-1", "finance-core", "metadata")
        self.assertEqual("DATASOURCE_FORBIDDEN", captured.exception.code)

    def test_resolve_can_be_called_while_an_event_loop_is_running(self):
        modules, _calls = self.framework_modules()

        async def invoke():
            return DiscoveryClient().resolve("session-1", "3001", "metadata")

        with patch.dict(sys.modules, modules), patch.dict(
            os.environ, {"DBCLI_DATASOURCE_SERVICE": "datasource-service"}, clear=True
        ):
            resolved = asyncio.run(invoke())
        self.assertEqual("3001", resolved.resolution_id)

    def test_empty_resource_page_is_reported_as_not_found(self):
        modules, _calls = self.framework_modules(
            {"code": "0", "data": {"items": [], "total": "0", "pageNum": "1", "pageSize": "1"}}
        )
        with patch.dict(sys.modules, modules), patch.dict(
            os.environ, {"DBCLI_DATASOURCE_SERVICE": "datasource-service"}, clear=True
        ):
            with self.assertRaises(DbCliError) as captured:
                DiscoveryClient().resolve("session-1", "3001", "metadata")
        self.assertEqual("DATASOURCE_NOT_FOUND", captured.exception.code)

    def test_http_500_exposes_sanitized_backend_error(self):
        modules, _calls = self.framework_modules(
            {
                "code": "50001",
                "msg": "failed to decrypt datasource password",
                "detail": {"password": "plain-secret", "exception": "DecryptException"},
            },
            status_code=500,
        )
        with patch.dict(sys.modules, modules), patch.dict(
            os.environ, {"DBCLI_DATASOURCE_SERVICE": "ByaiService"}, clear=True
        ):
            with self.assertRaises(DbCliError) as captured:
                DiscoveryClient().resolve("20071940", "20071931", "metadata")
        message = captured.exception.message
        self.assertIn("HTTP 500", message)
        self.assertIn("50001", message)
        self.assertIn("DecryptException", message)
        self.assertNotIn("plain-secret", message)

    def test_opengauss_ssl_modes_and_default_schema_are_mapped_to_psycopg(self):
        for ssl_mode in ("disable", "require", "verify-ca", "verify-full"):
            with self.subTest(ssl_mode=ssl_mode):
                item = copy.deepcopy(SESSION_RESOURCE)
                item["connectionConfig"]["sslMode"] = ssl_mode
                resolution = DiscoveryClient._session_resource_to_resolution(
                    {"items": [item]}, "3001"
                )
                self.assertEqual(ssl_mode, resolution["options"]["sslmode"])
                self.assertEqual("-c search_path=finance", resolution["options"]["options"])

    def test_unknown_ssl_mode_is_rejected_before_database_connection(self):
        item = copy.deepcopy(SESSION_RESOURCE)
        item["connectionConfig"]["sslMode"] = "prefer"
        with self.assertRaises(DbCliError) as captured:
            DiscoveryClient._session_resource_to_resolution({"items": [item]}, "3001")
        self.assertEqual("DISCOVERY_PROTOCOL_ERROR", captured.exception.code)


if __name__ == "__main__":
    unittest.main()
