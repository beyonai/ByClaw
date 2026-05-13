package com.iwhalecloud.byai.common.storage.validation.validator;

import org.springframework.stereotype.Component;

/**
 * `view` 资源 JSON 校验器。
 */
@Component
public class ViewResourceJsonTypeValidator extends AbstractLoggingResourceJsonTypeValidator {

    @Override
    public boolean supports(String resourceBizType) {
        return "VIEW".equalsIgnoreCase(resourceBizType);
    }
}
