package com.iwhalecloud.byai.manager.dto.template;

import lombok.Data;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 模版规则信息创建请求
 * 
 * @author system
 * @date 2025-01-XX
 */
@Data
public class TemplateRuleInfoCreateRequest {

    @NotBlank(message = "规则名称不能为空")
    private String ruleName;

    @NotBlank(message = "规则内容不能为空")
    private String ruleContent;

    @NotNull(message = "模版类型")
    private String templateType;
}

