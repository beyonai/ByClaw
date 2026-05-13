package com.iwhalecloud.byai.common.storage.validation.validator;

import org.springframework.stereotype.Component;

/**
 * `dig_employee` 资源 JSON 校验器。
 */
@Component
public class DigEmployeeResourceJsonTypeValidator extends AbstractLoggingResourceJsonTypeValidator {

    @Override
    public boolean supports(String resourceBizType) {
        return "DIG_EMPLOYEE".equalsIgnoreCase(resourceBizType);
    }
}
