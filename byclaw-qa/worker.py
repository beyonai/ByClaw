"""by-framework worker for instant search."""

from __future__ import annotations

import os
import re
import json
from contextlib import aclosing
from datetime import datetime
from typing import Any, Dict

from by_framework.common.emitter import SseReasonMessageType
import by_framework.core.protocol.event_type as event_type_mod
import by_framework.worker as worker_mod
from by_framework.worker.context import AskAgentCommand
from by_framework.util.http_client import ByHttpClient
import dotenv
from by_qa.qa.instant.nodes.node_enum import NodeNames
from by_qa.qa.instant.runtime.operation_registry import OPERATION_REGISTRY, OperationType
from by_qa.core import logger
from by_qa.qa.common.models import CoreInput, StreamEventType
from by_qa.qa.instant.engine import InstantSearchEngine
from redis_agent_config import convert_agent_config_to_engine_config
from minio_agent_config import load_agent_config_from_minio
from minio_client import MinioResourceClient
from by_framework.core.discovery import DiscoveryClient
from by_framework.util.discovery_http_client import DiscoveryHttpClient
from by_framework.util.http_client import RetryConfig

dotenv.load_dotenv()

_minio = MinioResourceClient()


FINAL_ANSWER_ROLES = {
    "aggregator",
    "subanswer_aggregator",
}
SEARCH_TOOL_NAME = OPERATION_REGISTRY[OperationType.SEARCH].tool_name


def parse_dataset_ids(value: str | None) -> list[int]:
    """Parse comma-separated dataset ids from environment variable."""
    if not value or not value.strip():
        return []

    dataset_ids: list[int] = []
    for item in value.split(","):
        item = item.strip()
        if item:
            dataset_ids.append(int(item))
    return dataset_ids


def _sanitize_filename(name: str) -> str:
    name = re.sub(r'[/\\:*?"<>|\s]', "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    return name[:50]


async def generate_report_filename(content: str, llm_service: Any) -> str:
    try:
        prompt = [
            {
                "role": "user",
                "content": (
                    "根据以下报告内容，生成一个简短的中文文件名"
                    "（不超过20字，不含标点和特殊字符）：\n" + content
                ),
            }
        ]
        name = await llm_service.generate(prompt)
        name = _sanitize_filename(name.strip())
        if name:
            return name
    except Exception as exc:
        logger.warning("Failed to generate report filename from LLM output: %s", exc)
    return f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


async def upload_report(content: str, filename: str, session_id: str, user_code: str) -> bool:
    be_domain = os.getenv("BE_DOMAINNAME")
    if not be_domain:
        logger.warning("BE_DOMAINNAME is not configured; skipping report upload")
        return False

    try:
        discovery_client = DiscoveryClient(cache_interval=5)
        retry_config = RetryConfig(
            max_attempts=3,
            retry_on_status_codes={502, 503, 504},
        )
        file_path = f"/qa/{_sanitize_filename(filename)}.md"
        logger.info(
            "Uploading report for user=%s session=%s path=%s to service=%s",
            user_code,
            session_id,
            file_path,
            be_domain,
        )
        async with DiscoveryHttpClient(discovery_client, retry_config=retry_config) as client:
            resp = await client.post(
                service_name=be_domain,
                path="/byaiService/open/api/v1/conversation/writeTxt",
                json={
                    "userCode": user_code,
                    "sessionId": session_id,
                    "filePath": file_path,
                    "content": content,
                },
            )
            if not resp.is_success:
                logger.error("Report upload failed with status=%s", resp.status_code)
                return False
            response_body = resp.data
            result_code = response_body.get("code") if isinstance(response_body, dict) else None
            result_success = (
                response_body.get("success") if isinstance(response_body, dict) else None
            )
            if result_code != 0 or result_success is not True:
                logger.error(
                    "Report upload failed with response code=%s success=%s body=%s",
                    result_code,
                    result_success,
                    response_body,
                )
                return False
            logger.info("Report uploaded successfully to %s", file_path)
            return True
    except Exception as exc:
        logger.error("Report upload raised an exception: %s", exc)
        return False


def convert_node_name_to_title(node_name: str) -> str:
    if node_name == NodeNames.DECOMPOSER.value:
        return "问题分解"
    elif node_name == SEARCH_TOOL_NAME:
        return "信息检索"
    elif node_name == NodeNames.SINGLE_HOP_WORKER.value:
        return "单跳问题处理"
    elif node_name == NodeNames.MULTI_HOP_WORKER.value:
        return "多跳问题处理"
    elif (
        node_name == NodeNames.FINAL_ANSWER.value
        or node_name == NodeNames.SUBANSWER_AGGREGATOR.value
    ):
        return "答案聚合"
    elif node_name == NodeNames.MULTI_HOP_AGENT.value:
        return "多跳问题信息检索"
    elif node_name == NodeNames.MULTI_HOP_SUMMARY.value:
        return "多跳问题答案总结"
    elif node_name == NodeNames.SINGLE_HOP_AGENT.value:
        return "单跳问题信息检索"
    return None


def select_knowledge_bases(
    knowledge_bases: list[dict[str, Any]], call_kb_ids: Any
) -> tuple[list[dict[str, Any]], list[str]]:
    if not call_kb_ids:
        return knowledge_bases, []

    requested_codes = [str(code) for code in call_kb_ids]
    available_codes = {
        str(knowledge_base.get("kb_code") or "") for knowledge_base in knowledge_bases
    }
    missing_codes = [code for code in requested_codes if code not in available_codes]
    if missing_codes:
        return [], missing_codes

    requested_code_set = set(requested_codes)
    selected_knowledge_bases = [
        knowledge_base
        for knowledge_base in knowledge_bases
        if str(knowledge_base.get("kb_code") or "") in requested_code_set
    ]
    return selected_knowledge_bases, []


class InstantSearchWorker(worker_mod.GatewayWorker):
    """Expose InstantSearchEngine through by-framework GatewayWorker."""

    def get_agent_types(self) -> list[str]:
        return ["BYCLAW_QA"]

    async def process_command(
        self, command: AskAgentCommand, context: worker_mod.AgentContext
    ) -> str:
        agent_id = command.extra_payload.get("agent_id", None)
        if agent_id is None:
            message = "未指定可用数字员工，无法执行检索。"
            logger.warning("Instant search request rejected: missing agent_id in extra_payload")
            await context.emit_chunk(
                message,
                event_type=event_type_mod.EventType.ANSWER_DELTA.value,
            )
            return message
        user_code = context.agent_runtime_state.session_manager.user_code
        if user_code == "" or user_code == "default":
            user_code = command.header.metadata.get("user_code", "default")
        if user_code == "default":
            logger.warning("No valid user_code found for agent_id=%s; using default", agent_id)
        session_id = context.session_id

        agent_config = await load_agent_config_from_minio(_minio, str(agent_id))
        if agent_config is None:
            message = "当前数字员工未配置检索能力，无法执行检索。"
            logger.warning(
                "Instant search request rejected: agent_id=%s has no retrieval config",
                agent_id,
            )
            await context.emit_chunk(
                message,
                event_type=event_type_mod.EventType.ANSWER_DELTA.value,
            )
            return message

        config = convert_agent_config_to_engine_config(agent_config)
        loaded_knowledge_bases = config.get("retrieval", {}).get("knowledge_bases", [])
        logger.info(
            "Loaded %s knowledge base(s) for agent_id=%s",
            len(loaded_knowledge_bases),
            agent_id,
        )
        if not loaded_knowledge_bases:
            message = "当前未配置可用知识库，无法执行检索。"
            logger.warning(
                "Instant search request rejected: agent_id=%s has no available knowledge bases",
                agent_id,
            )
            await context.emit_chunk(
                message,
                event_type=event_type_mod.EventType.ANSWER_DELTA.value,
            )
            return message

        call_kb_ids = command.extra_payload.get("call_kb_ids")

        selected_knowledge_bases, missing_kb_codes = select_knowledge_bases(
            loaded_knowledge_bases,
            call_kb_ids,
        )
        if missing_kb_codes:
            message = "知识库编码不存在：" + "、".join(missing_kb_codes)
            logger.warning(
                "Instant search request rejected: requested call_kb_ids are not available for agent_id=%s: %s",
                agent_id,
                missing_kb_codes,
            )
            await context.emit_chunk(
                message,
                event_type=event_type_mod.EventType.ANSWER_DELTA.value,
            )
            return message
        if selected_knowledge_bases is not loaded_knowledge_bases:
            config = {
                **config,
                "retrieval": {
                    **config.get("retrieval", {}),
                    "knowledge_bases": selected_knowledge_bases,
                },
            }
            logger.info(
                "Filtered knowledge bases for agent_id=%s based on call_kb_ids; %s knowledge base(s) remain",
                agent_id,
                len(selected_knowledge_bases),
            )

        session_id = command.header.session_id
        parent_message_id = command.header.parent_message_id
        root_message_id = command.header.message_id

        query = str(getattr(command, "content", "")).strip()
        logger.info(
            "Starting instant search for agent_id=%s session_id=%s query_length=%s",
            agent_id,
            session_id,
            len(query),
        )

        input_data = CoreInput(
            query=query,
            session_id=session_id,
            message_id=root_message_id,
            dataset_ids=None,
        )

        final_answer_parts: list[str] = []
        has_error = False

        chunks: list[str] = []
        async with InstantSearchEngine(config=config) as engine:
            async with aclosing(engine.stream_search(input_data)) as stream:
                async for event in stream:
                    parent_message_ids = event.parent_ids if event.parent_ids else [parent_message_id]
                    if event.type.value == StreamEventType.NODE_END.value:
                        continue
                    if event.type.value == StreamEventType.NODE_START.value:
                        message_id = event.instance_id
                        title = convert_node_name_to_title(event.role)
                        if title:
                            await context.emit_chunk(
                                title
                                + (
                                    f": {event.data.get('content', '')}"
                                    if event.data.get("content", "")
                                    else ""
                                ),
                                event_type=event_type_mod.EventType.REASONING_LOG_DELTA.value,
                                content_type=(
                                    SseReasonMessageType.think_title.value
                                    if parent_message_ids[-1] == root_message_id
                                    else None
                                ),
                                message_id=message_id,
                                parent_message_id=parent_message_ids[-1],
                            )
                        continue
                    if event.type.value == StreamEventType.ERROR.value:
                        has_error = True
                        final_answer_parts = [json.dumps(event.data, ensure_ascii=False)]
                        logger.error(
                            "Instant search stream returned an error for agent_id=%s session_id=%s: %s",
                            agent_id,
                            session_id,
                            final_answer_parts,
                        )
                        break

                    message_id = event.instance_id
                    event_type = event_type_mod.EventType.REASONING_LOG_DELTA.value
                    content = event.data.get("content", "")
                    if event.type.value == "search_result_chunks":
                        chunks.extend(event.data.get("chunks", []))
                    elif event.role in [
                        NodeNames.FINAL_ANSWER.value,
                        NodeNames.SUBANSWER_AGGREGATOR.value,
                    ]:
                        final_answer_parts.append(content)
                        parent_message_ids = [parent_message_id]
                        message_id = root_message_id
                        event_type = event_type_mod.EventType.ANSWER_DELTA.value

                    if content:
                        await context.emit_chunk(
                            content,
                            event_type=event_type,
                            message_id=message_id,
                            parent_message_id=parent_message_ids[-1],
                        )
        final_answer = "".join(final_answer_parts).strip()
        if final_answer and not has_error:
            from by_qa.qa.services.llm_service import LLMService
            from redis_model_config import RedisModelConfigProvider

            provider = RedisModelConfigProvider(context.redis)
            await provider.load_cache()
            llm_service = LLMService(provider=provider)
            filename = await generate_report_filename(final_answer, llm_service)
            report_uploaded = await upload_report(final_answer, filename, session_id, user_code)
            if report_uploaded:
                await context.emit_chunk(
                    "\n\n报告已保存到：/qa/" + filename + ".md",
                    event_type=event_type_mod.EventType.ANSWER_DELTA.value,
                )
                final_answer += "\n\n报告已保存到：/qa/" + filename + ".md"
            else:
                logger.warning(
                    "Report upload did not complete successfully for agent_id=%s session_id=%s",
                    agent_id,
                    session_id,
                )
                upload_failure_message = "\n\n报告保存失败，未写入会话文件。"
                await context.emit_chunk(
                    upload_failure_message,
                    event_type=event_type_mod.EventType.ANSWER_DELTA.value,
                )
                final_answer += upload_failure_message
        elif has_error:
            logger.warning(
                "Returning error answer to client for agent_id=%s session_id=%s",
                agent_id,
                session_id,
            )
            await context.emit_chunk(
                "[搜问运行异常] " + final_answer,
                event_type=event_type_mod.EventType.ANSWER_DELTA.value,
            )
        else:
            logger.warning(
                "Instant search finished without a final answer for agent_id=%s session_id=%s",
                agent_id,
                session_id,
            )
        return final_answer


def main() -> None:
    worker_mod.run_worker(
        InstantSearchWorker,
        worker_id=os.getenv("BYAI_WORKER_ID", "instant-search-worker-1"),
        redis_host=os.getenv("BYAI_REDIS_HOST", "10.10.168.204"),
        redis_port=int(os.getenv("BYAI_REDIS_PORT", 6379)),
        redis_db=int(os.getenv("BYAI_REDIS_DB", 0)),
        redis_username=os.getenv("BYAI_REDIS_USERNAME"),
        redis_password=os.getenv("BYAI_REDIS_PASSWORD") or None,
    )


if __name__ == "__main__":
    main()
