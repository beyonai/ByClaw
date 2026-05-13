package com.iwhalecloud.byai.common.storage.validation;

/**
 * 单个 resourceBizType 的资源 JSON 强校验器。
 */
public interface ResourceJsonTypeValidator {

    boolean supports(String resourceBizType);

    void validate(ResourceJsonValidationContext context);
}
