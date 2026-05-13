package com.iwhalecloud.byai.common.storage.validation.validator;

import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * 默认资源 JSON 校验器。未命中具体类型校验器时走这里，
 * 并复用父类统一打印类型、目标路径和 JSON 内容。
 */
@Order
@Component
public class DefaultResourceJsonTypeValidator extends AbstractLoggingResourceJsonTypeValidator {

    @Override
    public boolean supports(String resourceBizType) {
        return false;
    }
}
