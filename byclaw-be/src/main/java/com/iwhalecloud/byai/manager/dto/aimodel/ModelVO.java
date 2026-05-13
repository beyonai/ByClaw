package com.iwhalecloud.byai.manager.dto.aimodel;

import java.io.Serializable;
import java.util.List;
import java.util.Map;
import lombok.Data;

/**
 * 模型详情对象（与接口文档 Model 一致）
 * 用于列表行与详情/编辑回显
 *
 * @author system
 */
@Data
public class ModelVO implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 模型 ID */
    private String id;

    /** 模型名称（前端标题） */
    private String displayName;

    /** 提供商（如 OpenAI） */
    private String providerName;

    /** 型号（如 gpt-4-turbo-preview） */
    private String modelCode;

    /** 模型类型（目前仅 LLM） */
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

    /** API Token（仅详情/编辑回显返回明文；列表不返回） */
    private String apiToken;

    /** 脱敏 token（列表/详情可返回，如 sk-****abcd） */
    private String apiTokenMasked;

    /** Headers 动态列表 */
    private List<Map<String, String>> headers;

    /** 连接超时（秒） */
    private Integer connectTimeoutSec;

    /** 读取超时（秒） */
    private Integer readTimeoutSec;

    /** 最大重试次数 */
    private Integer maxRetries;

    /** 重试间隔（秒） */
    private Integer retryIntervalSec;

    /** 高级参数 */
    private Double temperature;

    private Double topP;

    private Integer maxTokens;

    private Double frequencyPenalty;

    private Double presencePenalty;

    /** 最近更新时间（ISO8601 或 YYYY-MM-DD HH:mm:ss） */
    private String updatedAt;

    /** 入参模板（详情/列表返回） */
    private String inparamTemplate;
}
