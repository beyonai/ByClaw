"""TC-33 ~ TC-35: 静态检查 — init_agent_conf.py paradigm wrapper 已删除，职责已收窄。

通过搜索源文件文本验证：
- TC-33: 五阶段 paradigm wrapper 的核心函数与调用点已删除
- TC-34: build_five_stage_from_frontend_reply 已由 _apply_resume_to_params 替代
- TC-35: 文件不含旧式工具参数 schema 定义或执行闭包；新接口（contextKnowledge）已就位
"""
from __future__ import annotations

from pathlib import Path

_INIT_CONF = (
    Path(__file__).resolve().parent.parent
    / "src" / "byclaw_data" / "plugins" / "worker_plugins" / "init_agent_conf.py"
)


def _src() -> str:
    return _INIT_CONF.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# TC-33: paradigm wrapper 核心代码已删除
# ---------------------------------------------------------------------------

def test_tc33_file_exists() -> None:
    """init_agent_conf.py 文件存在（路径正确，后续断言有意义）。"""
    assert _INIT_CONF.is_file(), f"文件不存在：{_INIT_CONF}"


def test_tc33_build_query_tool_function_deleted() -> None:
    """五阶段 paradigm wrapper 主体函数 _build_query_tool 已删除。"""
    assert "def _build_query_tool" not in _src(), (
        "_build_query_tool（五阶段 paradigm wrapper）仍存在于 init_agent_conf.py，应删除"
    )


def test_tc33_paradigm_env_flag_deleted() -> None:
    """DATACLOUD_ENABLE_PARADIGM_WRAPPER 环境变量检查逻辑已删除。"""
    assert "DATACLOUD_ENABLE_PARADIGM_WRAPPER" not in _src(), (
        "DATACLOUD_ENABLE_PARADIGM_WRAPPER 仍存在，paradigm wrapper 开关应一并删除"
    )


def test_tc33_resolve_five_stage_query_deleted() -> None:
    """resolve_five_stage_query（OWL 词条解析）调用已删除。"""
    assert "resolve_five_stage_query" not in _src(), (
        "resolve_five_stage_query 仍存在，OWL 词条解析链路应已移除"
    )


def test_tc33_normalize_five_stage_args_deleted() -> None:
    """normalize_five_stage_args 调用已删除。"""
    assert "normalize_five_stage_args" not in _src()


def test_tc33_five_stage_to_legacy_question_deleted() -> None:
    """five_stage_to_legacy_question（五阶段 → 自然语言字符串拼接）调用已删除。"""
    assert "five_stage_to_legacy_question" not in _src(), (
        "five_stage_to_legacy_question 仍存在，冗余自然语言转换应已删除"
    )


def test_tc33_five_stage_to_structured_payload_deleted() -> None:
    """five_stage_to_structured_payload（五阶段 → OQL dict 转换）调用已删除。"""
    assert "five_stage_to_structured_payload" not in _src()


def test_tc33_is_paradigm_wrapper_enabled_deleted() -> None:
    """_is_paradigm_wrapper_enabled() 函数已删除。"""
    assert "_is_paradigm_wrapper_enabled" not in _src()


def test_tc33_build_ontology_query_wrappers_deleted() -> None:
    """_build_ontology_query_wrappers() 函数定义已删除（原先批量注册五阶段工具的入口）。"""
    import re
    # 仅检查函数定义，不检查注释中的引用
    assert not re.search(r"^\s*def _build_ontology_query_wrappers", _src(), re.MULTILINE), (
        "_build_ontology_query_wrappers 函数定义仍存在，应已删除"
    )


# ---------------------------------------------------------------------------
# TC-34: build_five_stage_from_frontend_reply 已由 _apply_resume_to_params 替代
# ---------------------------------------------------------------------------

def test_tc34_build_five_stage_from_frontend_reply_not_imported() -> None:
    """build_five_stage_from_frontend_reply 不再被 init_agent_conf.py 导入或调用。"""
    assert "build_five_stage_from_frontend_reply" not in _src(), (
        "build_five_stage_from_frontend_reply 仍存在，应由框架层 _apply_resume_to_params 替代"
    )


def test_tc34_paradigm_module_not_imported() -> None:
    """byclaw_data.paradigm 子包不再被 init_agent_conf.py 导入（paradigm 相关依赖已移除）。"""
    src = _src()
    assert "from byclaw_data.paradigm" not in src and "import byclaw_data.paradigm" not in src, (
        "byclaw_data.paradigm 仍被导入，应完全移除 paradigm 相关依赖"
    )


# ---------------------------------------------------------------------------
# TC-35: init_agent_conf.py 职责收窄——新接口已就位，旧逻辑已清除
# ---------------------------------------------------------------------------

def test_tc35_new_interface_context_knowledge_present() -> None:
    """_build_single_db_query_tool 使用新 query/contextKnowledge 接口（非五阶段参数）。"""
    assert "contextKnowledge" in _src(), (
        "_build_single_db_query_tool 未使用 contextKnowledge 接口，新接口应已就位"
    )


def test_tc35_knowledge_context_sdk_param_present() -> None:
    """_execute 闭包通过 knowledge_context 参数调用 SDK（接口透传正确）。"""
    assert "knowledge_context" in _src(), (
        "未找到 knowledge_context 参数——SDK 调用 obj.query(knowledge_context=...) 应已就位"
    )


def test_tc35_no_build_five_stage_query_model() -> None:
    """build_five_stage_query_model 调用已删除（不再生成五阶段 schema）。"""
    assert "build_five_stage_query_model" not in _src()


def test_tc35_no_build_five_stage_tool_description() -> None:
    """build_five_stage_tool_description 调用已删除（不再生成五阶段工具描述）。"""
    assert "build_five_stage_tool_description" not in _src()
