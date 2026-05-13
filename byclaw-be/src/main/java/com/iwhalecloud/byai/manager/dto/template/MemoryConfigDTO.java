package com.iwhalecloud.byai.manager.dto.template;

import lombok.Data;

/**
 * 记忆配置DTO（用于数字员工编辑接口回显）
 * 
 * @author system
 * @date 2025-01-XX
 */
@Data
public class MemoryConfigDTO {

    /**
     * 场景名称
     */
    private String ruleName;

    /**
     * 场景内容
     */
    private String ruleContent;

    /**
     * 场景id
     */
    private Long templateId;
}

