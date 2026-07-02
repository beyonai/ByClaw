package com.iwhalecloud.byai.manager.qo.aimodel;

import lombok.Getter;
import lombok.Setter;

/**
 * 按条件查询单个模型（byai_aimodel）的查询对象。
 */
@Getter
@Setter
public class FindAiModelQo {

    /** 模型 ID */
    private Long modelId;

    /** 模型类型，如 LLM */
    private String modelType;

    /** 模型编号 */
    private String modelNo;

    /** 模型协议，如 OpenAI / Anthropic */
    private String modelProtocol;

    /** 模型归属：PUBLIC / PERSONAL */
    private String ownerType;

    /** 模型来源，如 TOKEN_SAVER */
    private String sourceType;

    /** 创建人 ID */
    private Long createBy;

    /** 状态：OOA / OOX / OOD */
    private String status;
}
