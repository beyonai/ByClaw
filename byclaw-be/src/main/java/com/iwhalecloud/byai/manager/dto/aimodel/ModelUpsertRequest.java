package com.iwhalecloud.byai.manager.dto.aimodel;

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

    /** 入参模板 */
    private String inparamTemplate;
}
