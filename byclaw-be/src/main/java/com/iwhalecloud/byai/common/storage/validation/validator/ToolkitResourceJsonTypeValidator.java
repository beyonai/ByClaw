package com.iwhalecloud.byai.common.storage.validation.validator;

import org.springframework.stereotype.Component;

/**
 * `toolkit` 资源 JSON 校验器。
 */
@Component
public class ToolkitResourceJsonTypeValidator extends AbstractLoggingResourceJsonTypeValidator {

    @Override
    public boolean supports(String resourceBizType) {
        return "TOOLKIT".equalsIgnoreCase(resourceBizType);
    }
}
