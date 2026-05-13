package com.iwhalecloud.byai.common.storage.validation.validator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.iwhalecloud.byai.common.storage.validation.ResourceJsonTypeValidator;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidationContext;

/**
 * 类型资源 JSON 校验器的统一日志基类。
 */
public abstract class AbstractLoggingResourceJsonTypeValidator implements ResourceJsonTypeValidator {

    private final Logger logger = LoggerFactory.getLogger(getClass());

    @Override
    public void validate(ResourceJsonValidationContext context) {
        logger.info("执行资源JSON校验器: validator={}, resourceBizType={}, path={}, json={}",
            getClass().getSimpleName(),
            context.resourceJsonPath().resourceBizType(),
            context.resourceJsonPath().targetPath(),
            context.json());
        doValidate(context);
    }

    protected void doValidate(ResourceJsonValidationContext context) {
        // Reserved for type-specific validation rules.
    }
}
