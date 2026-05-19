"""Lightweight i18n via dictionary mapping and contextvars.

Uses ContextVar to hold the current language per async task.
Each coroutine gets its own copy, so concurrent requests with
different languages won't interfere with each other.

Usage:
    set_lang("en_US")   # call once at request entry point
    t("no_agent")       # returns the translated string anywhere downstream
"""

from __future__ import annotations

from contextvars import ContextVar
from enum import Enum

# ContextVar is async-safe: each asyncio.Task inherits a snapshot of the
# parent context at creation time, and .set() only affects the current task.
_current_lang: ContextVar[str] = ContextVar("_current_lang", default="zh_CN")


class Msg(str, Enum):
    NO_AGENT = "no_agent"
    NO_RETRIEVAL_CAPABILITY = "no_retrieval_capability"
    NO_KNOWLEDGE_BASE = "no_knowledge_base"
    KB_CODE_NOT_FOUND = "kb_code_not_found"
    REPORT_SAVED = "report_saved"
    REPORT_SAVE_FAILED = "report_save_failed"
    SEARCH_ERROR = "search_error"
    NODE_DECOMPOSER = "node.decomposer"
    NODE_SEARCH_KNOWLEDGE = "node.search_knowledge"
    NODE_SINGLE_HOP_WORKER = "node.single_hop_worker"
    NODE_MULTI_HOP_WORKER = "node.multi_hop_worker"
    NODE_ANSWER_AGGREGATION = "node.answer_aggregation"
    NODE_MULTI_HOP_AGENT = "node.multi_hop_agent"
    NODE_MULTI_HOP_SUMMARY = "node.multi_hop_summary"
    NODE_SINGLE_HOP_AGENT = "node.single_hop_agent"
    FALLBACK_FAILED_TO_GENERATE_ANSWER = "fallback.failed_to_generate_answer"
    FALLBACK_NO_SUB_QUERY_ANSWERS = "fallback.no_sub_query_answers"
    FALLBACK_NO_RETRIEVAL_RESULTS = "fallback.no_retrieval_results"
    FALLBACK_NO_INTERMEDIATE_STEPS = "fallback.no_intermediate_steps"
    PROMPT_GENERATE_FILENAME = "prompt.generate_filename"
    ERR_MINIO_ENDPOINT_MISSING = "err.minio_endpoint_missing"
    ERR_STORAGE_UNAVAILABLE = "err.storage_unavailable"
    ERR_MODEL_CONFIG_INVALID = "err.model_config_invalid"
    ERR_MODEL_NOT_FOUND = "err.model_not_found"


MESSAGES: dict[str, dict[Msg, str]] = {
    "zh_CN": {
        Msg.NO_AGENT: "未指定可用数字员工，无法执行检索。",
        Msg.NO_RETRIEVAL_CAPABILITY: "当前数字员工未配置检索能力，无法执行检索。",
        Msg.NO_KNOWLEDGE_BASE: "当前未配置可用知识库，无法执行检索。",
        Msg.KB_CODE_NOT_FOUND: "知识库编码不存在：{codes}",
        Msg.REPORT_SAVED: "\n\n报告已保存到：{path}",
        Msg.REPORT_SAVE_FAILED: "\n\n报告保存失败，未写入会话文件。",
        Msg.SEARCH_ERROR: "[搜问运行异常] {answer}",
        Msg.NODE_DECOMPOSER: "问题分解",
        Msg.NODE_SEARCH_KNOWLEDGE: "信息检索",
        Msg.NODE_SINGLE_HOP_WORKER: "单跳问题处理",
        Msg.NODE_MULTI_HOP_WORKER: "多跳问题处理",
        Msg.NODE_ANSWER_AGGREGATION: "答案聚合",
        Msg.NODE_MULTI_HOP_AGENT: "多跳问题信息检索",
        Msg.NODE_MULTI_HOP_SUMMARY: "多跳问题答案总结",
        Msg.NODE_SINGLE_HOP_AGENT: "单跳问题信息检索",
        Msg.FALLBACK_FAILED_TO_GENERATE_ANSWER: "生成答案失败。",
        Msg.FALLBACK_NO_SUB_QUERY_ANSWERS: "未找到子查询答案。",
        Msg.FALLBACK_NO_RETRIEVAL_RESULTS: "未找到相关检索结果。",
        Msg.FALLBACK_NO_INTERMEDIATE_STEPS: "未找到中间步骤信息。",
        Msg.PROMPT_GENERATE_FILENAME: (
            "根据以下报告内容，生成一个简短的中文文件名"
            "（不超过20字，不含标点和特殊字符）：\n"
        ),
        Msg.ERR_MINIO_ENDPOINT_MISSING: "存储服务配置缺失，无法执行检索。",
        Msg.ERR_STORAGE_UNAVAILABLE: "存储服务暂时不可用，请稍后重试。",
        Msg.ERR_MODEL_CONFIG_INVALID: "模型配置异常，无法执行检索。",
        Msg.ERR_MODEL_NOT_FOUND: "未找到可用的AI模型，无法执行检索。",
    },
    "en_US": {
        Msg.NO_AGENT: "No available agent specified; cannot perform search.",
        Msg.NO_RETRIEVAL_CAPABILITY: "The current agent has no retrieval capability configured.",
        Msg.NO_KNOWLEDGE_BASE: "No knowledge base is configured for retrieval.",
        Msg.KB_CODE_NOT_FOUND: "Knowledge base code(s) not found: {codes}",
        Msg.REPORT_SAVED: "\n\nReport saved to: {path}",
        Msg.REPORT_SAVE_FAILED: "\n\nFailed to save report; not written to session file.",
        Msg.SEARCH_ERROR: "[Search error] {answer}",
        Msg.NODE_DECOMPOSER: "Question Decomposition",
        Msg.NODE_SEARCH_KNOWLEDGE: "Information Retrieval",
        Msg.NODE_SINGLE_HOP_WORKER: "Single-hop Processing",
        Msg.NODE_MULTI_HOP_WORKER: "Multi-hop Processing",
        Msg.NODE_ANSWER_AGGREGATION: "Answer Aggregation",
        Msg.NODE_MULTI_HOP_AGENT: "Multi-hop Retrieval",
        Msg.NODE_MULTI_HOP_SUMMARY: "Multi-hop Summary",
        Msg.NODE_SINGLE_HOP_AGENT: "Single-hop Retrieval",
        Msg.FALLBACK_FAILED_TO_GENERATE_ANSWER: "Failed to generate answer.",
        Msg.FALLBACK_NO_SUB_QUERY_ANSWERS: "No sub-query answers found.",
        Msg.FALLBACK_NO_RETRIEVAL_RESULTS: "No relevant retrieval results found.",
        Msg.FALLBACK_NO_INTERMEDIATE_STEPS: "No intermediate step information found.",
        Msg.PROMPT_GENERATE_FILENAME: (
            "Based on the following report content, generate a short filename "
            "(no more than 20 characters, no punctuation or special characters):\n"
        ),
        Msg.ERR_MINIO_ENDPOINT_MISSING: "Storage service configuration is missing; cannot perform search.",
        Msg.ERR_STORAGE_UNAVAILABLE: "Storage service is temporarily unavailable. Please try again later.",
        Msg.ERR_MODEL_CONFIG_INVALID: "Model configuration is invalid; cannot perform search.",
        Msg.ERR_MODEL_NOT_FOUND: "No available AI model found; cannot perform search.",
    },
}

_FALLBACK_MESSAGE_KEY_MAP: dict[str, Msg] = {
    "Failed to generate answer.": Msg.FALLBACK_FAILED_TO_GENERATE_ANSWER,
    "No sub-query answers found.": Msg.FALLBACK_NO_SUB_QUERY_ANSWERS,
    "No relevant retrieval results found.": Msg.FALLBACK_NO_RETRIEVAL_RESULTS,
    "No intermediate step information found.": Msg.FALLBACK_NO_INTERMEDIATE_STEPS,
}


def set_lang(lang: str) -> None:
    _current_lang.set(lang)


def t(key: Msg) -> str:
    lang = _current_lang.get()
    locale_msgs = MESSAGES.get(lang, MESSAGES["zh_CN"])
    return locale_msgs.get(key, MESSAGES["zh_CN"].get(key, key))


def translate_fallback(text: str) -> str:
    key = _FALLBACK_MESSAGE_KEY_MAP.get(text)
    if key is None:
        return text
    return t(key)
