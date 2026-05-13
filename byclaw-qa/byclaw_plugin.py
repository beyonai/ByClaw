import asyncio
import json
import os
from typing import Any
from enum import Enum
from urllib.parse import urlparse

from by_framework.common.redis_client import init_redis
from by_framework.core.discovery import DiscoveryClient
from by_framework.core.extensions import AgentConfig, Plugin, PluginBuildContext, PluginManifest
from by_framework.util.discovery_http_client import DiscoveryHttpClient
from by_framework.util.http_client import RetryConfig

from by_qa.core import logger
# from by_qa.qa.common.models import RetrievalOperationType


# TODO: replace with by_qa.qa.common.models.RetrievalOperationType (not implemented yet)
class RetrievalOperationType(Enum):
    CREATE_DIR = "createDir"
    EDIT_DIR = "editDir"
    DELETE_DIR = "deleteDir"
    UPLOAD_FILE = "uploadFile"
    DELETE_FILE = "deleteFile"
    READ_FILE = "readFile"
    KNOWLEDGE_SEARCH = "knowledgeSearch"
    LIST_DIR = "listDir"
    GLOB = "glob"
    DOWNLOAD_FILE = "downloadFile"
    KNOWLEDGE_BUILD = "knowledgeBuild"


class ByPlugin(Plugin):

    def __init__(self, manifest: PluginManifest):
        super().__init__(manifest)

    @staticmethod
    def _get_backend_service_name() -> str:
        service_name = os.getenv("BE_DOMAINNAME")
        if not service_name:
            raise ValueError("BE_DOMAINNAME is not set")
        return service_name

    @staticmethod
    def _init_discovery_redis() -> None:
        redis_host = os.getenv("REDIS_HOST", "localhost")
        redis_port = int(os.getenv("REDIS_PORT", 6379))
        redis_db = int(os.getenv("REDIS_DATABASE", os.getenv("REDIS_DB", 0)))
        redis_password = os.getenv("REDIS_PASSWORD")
        redis_username = os.getenv("REDIS_USERNAME")

        init_redis(
            host=redis_host,
            port=redis_port,
            db=redis_db,
            password=redis_password or None,
            username=redis_username or None,
        )

    @classmethod
    async def _post_via_discovery(
        cls,
        client: DiscoveryHttpClient,
        service_name: str,
        path: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = await client.post(service_name, path, json=payload)
        if not response.is_success:
            raise ValueError(
                f"HTTP {response.status_code} calling {service_name}{path}: {response.data}"
            )

        if not isinstance(response.data, dict):
            raise ValueError(
                f"Unexpected response payload type from {service_name}{path}: "
                f"{type(response.data).__name__}"
            )

        return response.data

    @staticmethod
    def _format_api_error(payload: dict[str, Any] | None) -> str:
        payload = payload or {}
        code = payload.get("code")
        primary_message = payload.get("msg") or payload.get("message") or payload.get("error")
        if primary_message:
            return f"code={code}, message={primary_message}"

        serialized_payload = json.dumps(payload, ensure_ascii=False, default=str)
        if len(serialized_payload) > 300:
            serialized_payload = serialized_payload[:297] + "..."
        return f"code={code}, payload={serialized_payload}"

    @staticmethod
    def _is_complete_url(value: str) -> bool:
        parsed = urlparse(value)
        return bool(parsed.scheme and parsed.netloc)

    @classmethod
    def _extract_knowledge_bases(cls, payload: dict[str, Any]) -> list[dict[str, Any]]:
        knowledge_bases: list[dict[str, Any]] = []
        for item in payload.get("data", []) or []:
            try:
                services: dict[str, str] = {}
                target_content = json.loads(((item or {}).get("extDoc") or {}).get("targetContent") or "{}")
                domain_name = target_content.get("domainName", None)
                kb_code = item.get("resourceCode", None)
                kb_name = item.get("resourceName", None)
                kb_desc = item.get("resourceDesc", None)
                if not kb_code or not kb_name:
                    logger.warning("Skip knowledge base item without resourceCode, resourceName")
                    continue
                for service in target_content.get("resourceService", []):
                    paths = service.get("openapiSchema", {}).get("paths", {})
                    for path, path_item in paths.items():
                        action = path_item.get("post", {}).get("operationId", None)
                        if action:
                            try:
                                action = RetrievalOperationType(action)
                            except ValueError:
                                logger.warning(f"Skip unknown action: {action}")
                                continue
                            services[action] = path
                
                if RetrievalOperationType.KNOWLEDGE_SEARCH not in services:
                    logger.warning(
                        "Knowledge base %s(%s) does not provide %s service",
                        kb_code,
                        kb_name,
                        RetrievalOperationType.KNOWLEDGE_SEARCH.value,
                    )

                knowledge_bases.append(
                    {
                        "kb_code": str(kb_code),
                        "kb_name": str(kb_name),
                        "kb_desc": str(kb_desc),
                        "urls": services,
                        "service_name": domain_name,
                    }
                )
            except Exception as exc:
                logger.warning(f"Skip malformed knowledge base item: {exc}")
        return knowledge_bases

    async def register_agent_configs(self, build_context: PluginBuildContext) -> list[AgentConfig]:
        try:
            self._init_discovery_redis()
            backend_service_name = self._get_backend_service_name()
            logger.info("Using discovery backend service: %s", backend_service_name)

            discovery_client = DiscoveryClient(cache_interval=5)
            retry_config = RetryConfig(
                max_attempts=3,
                retry_on_status_codes={502, 503, 504},
            )

            async with DiscoveryHttpClient(discovery_client, retry_config=retry_config) as client:
                digital_employee_data = await self._post_via_discovery(
                    client,
                    backend_service_name,
                    "/byaiService/open/api/v1/queryDigEmployeeList",
                    {},
                )
                assert digital_employee_data.get("code") == 0, (
                    "获取问答数字员工清单失败: " + self._format_api_error(digital_employee_data)
                )

                digital_employee_list = digital_employee_data.get("data", []) or []
                logger.info(f"Discovered {len(digital_employee_list)} digital employees")

                async def fetch_employee_agent_config(item: dict[str, Any]) -> AgentConfig | None:
                    digital_employee_id = item.get("resourceId")
                    if not digital_employee_id:
                        logger.warning("Skip digital employee without resourceId")
                        return None

                    try:
                        kb_data = await self._post_via_discovery(
                            client,
                            backend_service_name,
                            "/byaiService/open/api/v1/queryDigEmployeeSkills",
                            {
                                "resourceBizType": "KG_DOC",
                                "resourceId": str(digital_employee_id),
                            },
                        )
                        if kb_data.get("code") != 0:
                            raise ValueError(self._format_api_error(kb_data))

                        knowledge_bases = self._extract_knowledge_bases(kb_data)
                        if not knowledge_bases:
                            logger.warning(
                                f"Skip digital employee {digital_employee_id}: no valid knowledge bases"
                            )
                            return None

                        return AgentConfig(
                            agent_id=str(digital_employee_id),
                            knowledge_bases={
                                str(digital_employee_id): knowledge_bases,
                            },
                        )
                    except Exception as exc:
                        logger.error(f"获取数字员工 {digital_employee_id} 的知识库配置失败: {exc}")
                        return None

                tasks = [fetch_employee_agent_config(item) for item in digital_employee_list]
                results = await asyncio.gather(*tasks, return_exceptions=True)
            await discovery_client.close()

            agent_configs: list[AgentConfig] = []
            for result in results:
                if isinstance(result, Exception):
                    logger.error(f"并发获取数字员工知识库配置失败: {result}")
                    continue
                if result is not None:
                    agent_configs.append(result)

            if not agent_configs:
                raise ValueError("所有数字员工的 knowledge_bases 均为空")

            return agent_configs
        except Exception as e:
            logger.error(f"获取问答数字员工清单失败: {e}")
            raise
