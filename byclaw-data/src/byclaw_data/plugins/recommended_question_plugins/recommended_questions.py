"""LLM-based recommended follow-up questions for enterprise / grid analytics domains.

Runs concurrently with the main LangGraph stream; the worker only attaches results when
the background task has already finished, so the user-visible answer time is not extended.
"""

# ruff: noqa: RUF001 — domain copy uses fullwidth punctuation as delivered by product.

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from by_framework import AgentConfig, Plugin, PluginBuildContext, PluginManifest
from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Domain knowledge (required context for the recommender model)
# ---------------------------------------------------------------------------

_ENTERPRISE_FIELD_KNOWLEDGE = """
# 企业信息
字段名	字段描述
enterprise_id	企业唯一ID
enterprise_name	企业全称
stat_date	统计日期
industry_name	企业类型
business_status_name	企业经营状态
lng_lat	企业经纬度
height	地理高度
address	企业详细地址
total_revenue	企业总营收（万元）
total_tax	企业总缴税（万元）
total_profit	企业总利润（万元）
tax_rate	企业实际税负率（%）
avg_foot_traffic	企业日均人流量（人次）
foot_active_level_name	企业人流活跃等级
avg_vehicle_flow	企业日均车流量（辆次）
vehicle_active_level_name	企业车流活跃等级
avg_light_intensity	企业灯光强度
light_active_level_name	企业灯光活跃等级
chain_code	所属产业环节编码
chain_name	所属产业环节名称
manage_grid_id	管理网格编码
manage_grid_name	管理网格名称
enterprise_level_name	企业等级
risk_level_name	企业综合风险等级
update_time	分析表更新时间
etl_create_time	分析表创建时间
phy_grid_id	物理网格编码
phy_grid_name	物理网格名称
energy_efficiency_Index	企业经济效益等级（高、中、低）
"""

_MANAGE_GRID_FIELD_KNOWLEDGE = """
# 管理网格
| 字段名 | 字段描述 |
|--------|----------|
| manage_grid_id | 管理网格编码 |
| manage_grid_name | 管理网格名称 |
| grid_lnt_lat | 管理网格中心经纬度 |
| manage_wkt | 管理网格边界组 |
| stat_date | 统计日期 |
| area_sqm | 管理网格面积（平方米） |
| total_revenue | 管理网格总营收（万元） |
| total_tax | 管理网格总缴税（万元） |
| total_profit | 管理网格总利润（万元） |
| tax_rate | 管理网格实际税负率（%） |
| output_per_mu | 管理网格亩产效益（万元 / 亩） |
| avg_foot_traffic | 管理网格日均人流量（人次） |
| foot_active_level_name | 管理网格人流活跃等级 |
| avg_vehicle_flow | 管理网格日均车流量（辆次） |
| vehicle_active_level_name | 管理网格车流活跃等级 |
| avg_light_intensity | 管理网格日均灯光强度 |
| light_active_level_name | 管理网格灯光活跃等级 |
| poi_density | 管理网格POI 密度（个 / 平方公里） |
| update_time | 分析表更新时间 |
| etl_create_time | 分析表创建时间 |
| energy_efficiency_Index | 网格经济效益等级（高、中、低） |
"""

_SYSTEM_RULES = """
你是「产业大脑」对话助手里的追问推荐模块。请根据「用户当前问题」判断关注点，生成**总共 2～3 条**
后续可问问题（中文、简短、可独立成句）。**不要超过 3 条**；一般情况也**不要只输出 1 条**
（除非确实无法合理拆分出第二条）。

硬性规则（必须遵守）：
1）若用户主要在问「企业」（如某企业名、企业经营、企业指标、企业风险等），在 2～3 条内择优覆盖：
   - 该企业其它字段指标（须与下方企业字段知识一致，可点名具体字段含义）；
   - 该企业关联的管理网格 / 物理网格信息（manage_grid_*、phy_grid_*）。
2）若用户主要在问「网格 / 管理网格」（如网格营收、网格企业分布、网格边界等），在 2～3 条内择优覆盖：
   - 该网格其它字段指标（须与下方管理网格字段知识一致）；
   - 网格下的企业相关信息（可引导查询企业列表、头部企业、风险企业等）。
3）若同时涉及企业与网格，在 2～3 条内混合推荐，紧扣用户原问题。
4）若用户主要在问「产业」类问题（如产业链、产业环节、行业分布、产业集群、产业结构、上下游等），
   **只输出以下 3 条**（允许略作口语化，语义须与下列一致，且顺序建议保持一致），**不要追加**其它追问：
   - 查询全区的网格清单
   - 全区企业的按网格分布
   - 全区的企业清单
5）所有推荐问题必须能追溯到下方「知识背景」中的字段或实体类型；不要编造不存在的指标名。

输出要求：只输出一个 JSON 数组，元素为字符串，不要 Markdown，不要解释。数组长度须为 2 或 3
（第 4 条产业类场景固定为 3）。示例：["问题1","问题2"] 或 ["问题1","问题2","问题3"]
"""


def _default_recommend_model() -> str:
    return os.environ.get(
        "DATACLOUD_RECOMMEND_LLM_MODEL",
        os.environ.get("DATACLOUD_LLM_MODEL", "gpt-4o-mini"),
    ).strip()


def _parse_json_string_list(raw: str) -> list[str]:
    """Parse model output into a flat list of non-empty strings."""

    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        inner = "\n".join(lines[1:]) if len(lines) > 1 else text
        if inner.rstrip().endswith("```"):
            inner = inner[: inner.rfind("```")]
        text = inner.strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", text)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    out: list[str] = []
    for item in data:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
        elif isinstance(item, dict):
            q = str(item.get("q") or item.get("question") or "").strip()
            if q:
                out.append(q)
    return out[:3]


class RecommendedQuestionsPlugin(Plugin):
    """Background LLM recommender; worker consumes results only when already ready."""

    def __init__(self) -> None:
        super().__init__(
            manifest=PluginManifest(
                plugin_id="datacloud_recommended_questions",
                version="1.0.0",
                priority=5,
                enabled=False,  # temporarily disabled: rules are hardcoded
            )
        )

    async def register_agent_configs(
        self, build_context: PluginBuildContext
    ) -> list[AgentConfig] | None:
        """This plugin does not register agents."""

        _ = build_context
        return None

    async def generate_recommended_questions(self, user_query: str) -> list[str]:
        """Call the LLM to produce follow-up questions (may run inside asyncio.create_task).

        Args:
            user_query: Latest user utterance for this turn.

        Returns:
            Parsed question strings, or an empty list on failure or empty input.
        """

        q = (user_query or "").strip()
        if not q:
            return []

        api_key = os.environ.get("DATACLOUD_LLM_API_KEY", "").strip()
        if not api_key:
            logger.warning("RecommendedQuestionsPlugin: DATACLOUD_LLM_API_KEY missing, skip")
            return []

        provider = os.environ.get("DATACLOUD_LLM_MODEL_PROVIDER", "openai").strip().lower()
        api_base = os.environ.get("DATACLOUD_LLM_API_BASE", "").strip()
        model = _default_recommend_model()
        temperature = 0.35
        raw_temp = os.environ.get(
            "DATACLOUD_RECOMMEND_LLM_TEMPERATURE",
            os.environ.get("DATACLOUD_LLM_TEMPERATURE", ""),
        ).strip()
        if raw_temp:
            try:
                temperature = float(raw_temp)
            except ValueError:
                temperature = 0.35

        # kimi-k2.6 等模型对 thinking 模式有特定 temperature 限制，必须与主 LLM 保持一致
        raw_model_kwargs = os.environ.get("DATACLOUD_LLM_MODEL_KWARGS", "").strip()
        extra_model_kwargs: dict[str, Any] = {}
        if raw_model_kwargs:
            try:
                parsed = json.loads(raw_model_kwargs)
                if isinstance(parsed, dict):
                    extra_model_kwargs = parsed
            except (json.JSONDecodeError, ValueError):
                pass

        knowledge = (
            _ENTERPRISE_FIELD_KNOWLEDGE.strip() + "\n\n" + _MANAGE_GRID_FIELD_KNOWLEDGE.strip()
        )
        system_content = _SYSTEM_RULES.strip() + "\n\n# 知识背景（必须引用）\n" + knowledge

        llm_kwargs: dict[str, Any] = {
            **extra_model_kwargs,
            "model": model,
            "model_provider": provider,
            "api_key": api_key,
            "temperature": temperature,
            "max_tokens": 512,
        }
        if api_base:
            llm_kwargs["base_url"] = api_base
        llm = init_chat_model(**llm_kwargs)

        try:
            resp = await llm.ainvoke(
                [
                    SystemMessage(content=system_content),
                    HumanMessage(
                        content="用户当前问题如下，请生成 2～3 条推荐追问（JSON 数组）：\n" + q
                    ),
                ]
            )
        except Exception as exc:
            logger.warning(
                "RecommendedQuestionsPlugin: LLM invoke failed model=%s err=%s",
                model,
                exc,
            )
            return []

        raw_text = ""
        if hasattr(resp, "content"):
            raw_text = _coerce_llm_content_to_str(resp.content)
        else:
            raw_text = str(resp)

        parsed = _parse_json_string_list(raw_text)
        if not parsed:
            logger.info(
                "RecommendedQuestionsPlugin: empty parse model=%s preview=%r",
                model,
                raw_text[:200],
            )
        return parsed


def _coerce_llm_content_to_str(content: Any) -> str:
    """Flatten LangChain AIMessage.content (str or structured blocks) to plain text
    只提取 type=="text" 的块，过滤 thinking / tool_use 等非文字块，
    避免 MiniMax extended thinking 的 thinking block 混入推荐问题的输入。
    """

    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                # 只保留 text 类型的块，跳过 thinking / tool_use 等
                if block.get("type", "text") == "text":
                    t = block.get("text", "")
                    if isinstance(t, str):
                        parts.append(t)
            else:
                if getattr(block, "type", "text") == "text":
                    parts.append(str(getattr(block, "text", "")))
        return "".join(parts)
    return str(content)
