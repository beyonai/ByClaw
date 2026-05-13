package com.iwhalecloud.byai.manager.dto.template;

import lombok.Data;

import jakarta.validation.constraints.NotNull;

/**
 * 场景操作请求DTO
 * 
 * @author system
 * @date 2025-01-XX
 */
@Data
public class SceneOperationRequest {

    /**
     * 模板类型：DIGITAL_EMPLOYEE（数字员工）或 SUPER_ASSISTANT（超级助手）
     */
    private String templateType;

    /**
     * 模板ID
     */
    @NotNull(message = "模板ID不能为空")
    private Long templateId;

    /**
     * 资源ID（数字员工ID或超级助手的用户ID）
     */
    private Long resourceId;

    /**
     * 规则名称（修改场景时使用）
     */
    private String ruleName;

    /**
     * 规则内容（修改场景时使用）
     */
    private String ruleContent;
}

