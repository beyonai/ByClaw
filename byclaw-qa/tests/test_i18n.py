import json

from i18n import Msg, set_business_terminology, set_lang, t


def teardown_function():
    set_lang("zh_CN")
    set_business_terminology(None)


def test_business_terminology_uses_system_config_redis_value():
    config = {
        "zh-CN": {"singular": "专家", "plural": "专家"},
        "en-US": {"singular": "Expert", "plural": "Experts"},
    }
    redis_value = json.dumps({"paramValue": json.dumps(config, ensure_ascii=False)}).encode()

    set_business_terminology(redis_value)
    set_lang("zh_CN")
    assert t(Msg.NO_AGENT) == "未指定可用专家，无法执行检索。"

    set_lang("en_US")
    assert t(Msg.NO_RETRIEVAL_CAPABILITY) == (
        "The current expert has no retrieval capability configured."
    )


def test_business_terminology_falls_back_for_invalid_config():
    set_business_terminology(b"not-json")
    set_lang("zh_CN")
    assert t(Msg.NO_AGENT) == "未指定可用数字员工，无法执行检索。"
