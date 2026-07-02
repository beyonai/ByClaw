package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import java.util.List;
import java.util.Map;
import lombok.Data;

/**
 * 模型 Reasoning / Thinking 配置。字段名对齐 OpenClaw 的 reasoning、thinkingLevelMap、compat 语义。
 */
@Data
public class ModelReasoningConfig implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 是否默认启用 reasoning/thinking。 */
    private Boolean enabled;

    /** 默认 thinking 档位：off/minimal/low/medium/high/xhigh/adaptive/max。 */
    private String defaultLevel;

    /** 能力类型：unsupported/binary/effort/budget/adaptive。 */
    private String capability;

    /** Provider 兼容格式：auto/openai/qwen/qwen-chat-template/deepseek/openrouter/together/zai/anthropic。 */
    private String compatFormat;

    /** Provider 实际支持的 reasoning effort 列表。 */
    private List<String> supportedEfforts;

    /** OpenClaw thinking level 到 provider 原生 effort 的映射。 */
    private Map<String, String> effortMap;

    /** thinking budget tokens，按档位保存。 */
    private Map<String, Integer> budgets;
}
