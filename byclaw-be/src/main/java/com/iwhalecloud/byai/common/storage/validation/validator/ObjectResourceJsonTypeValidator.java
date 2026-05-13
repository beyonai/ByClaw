package com.iwhalecloud.byai.common.storage.validation.validator;

import org.springframework.stereotype.Component;

/**
 * `object` 资源 JSON 校验器。
 */
@Component
public class ObjectResourceJsonTypeValidator extends AbstractLoggingResourceJsonTypeValidator {

    @Override
    public boolean supports(String resourceBizType) {
        return "OBJECT".equalsIgnoreCase(resourceBizType);
    }
}
