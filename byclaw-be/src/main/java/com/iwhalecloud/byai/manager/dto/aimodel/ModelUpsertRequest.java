package com.iwhalecloud.byai.manager.dto.aimodel;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.io.Serializable;
import java.util.List;
import java.util.Map;
import lombok.Data;

/**
 * 模型新增/更新请求（与接口文档 upsertModel 入参一致）
 *
 * @author system
 */
@Data
public class ModelUpsertRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 有值表示更新，无值表示新增 */
    private String id;

    /** 模型名称 */
    private String displayName;

    /** 提供商 */
    private String providerName;

    /** 模型协议：OpenAI / Anthropic */
    private String modelProtocol;

    /** 型号 */
    private String modelCode;

    /** 模型类型，如 LLM */
    private String modelType;

    /** 状态：ENABLED/DISABLED/TESTING */
    private String status;

    /** 最大上下文 tokens */
    private Integer contextTokens;

    /** 能力列表 */
    private List<String> abilities;

    /** 系统标签列表 */
    private List<String> systems;

    /** 适用范围说明，作为模型元数据存储，不参与模型调用参数 */
    private String applicabilityScope;

    /** API Endpoint */
    private String apiEndpoint;

    /** API Token（建议后端加密存储） */
    private String apiToken;

    /** Headers */
    private List<Map<String, String>> headers;

    private Integer connectTimeoutSec;

    private Integer readTimeoutSec;

    private Integer maxRetries;

    private Integer retryIntervalSec;

    private Double temperature;

    private Double topP;

    private Integer maxTokens;

    private Double frequencyPenalty;

    private Double presencePenalty;

    /** Reasoning / Thinking 配置 */
    private ModelReasoningConfig reasoningConfig;

    /** 入参模板 */
    private String inparamTemplate;

    /**
     * 扩展json参数
     */
    private String extendParam;

    /** 区分旧客户端未提交与显式 null，保留历史清空语义。 */
    @JsonIgnore
    private boolean extendParamProvided;

    public void setExtendParam(String extendParam) {
        this.extendParam = extendParam;
        this.extendParamProvided = true;
    }

    /** 可选图片默认参数；null 表示沿用历史配置，空对象表示明确清空。 */
    private Map<String, Object> imageGenerationConfig;

    /** 模型归属: PUBLIC / PERSONAL */
    private String ownerType;

}
