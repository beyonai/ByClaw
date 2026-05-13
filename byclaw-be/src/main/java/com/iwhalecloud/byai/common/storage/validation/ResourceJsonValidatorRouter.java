package com.iwhalecloud.byai.common.storage.validation;

import java.util.List;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.storage.validation.validator.DefaultResourceJsonTypeValidator;

/**
 * 按 resourceBizType 路由到对应的资源 JSON 强校验器。
 */
@Component
public class ResourceJsonValidatorRouter {

    private final List<ResourceJsonTypeValidator> validators;
    private final DefaultResourceJsonTypeValidator defaultValidator;

    public ResourceJsonValidatorRouter(List<ResourceJsonTypeValidator> validators,
        DefaultResourceJsonTypeValidator defaultValidator) {
        this.validators = validators;
        this.defaultValidator = defaultValidator;
    }

    public void validate(ResourceJsonValidationContext context) {
        String resourceBizType = context.resourceJsonPath().resourceBizType();
        validators.stream()
            .filter(validator -> !(validator instanceof DefaultResourceJsonTypeValidator))
            .filter(validator -> validator.supports(resourceBizType))
            .findFirst()
            .orElse(defaultValidator)
            .validate(context);
    }
}
