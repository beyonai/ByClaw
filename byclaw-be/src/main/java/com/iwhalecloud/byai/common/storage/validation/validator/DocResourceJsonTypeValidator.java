package com.iwhalecloud.byai.common.storage.validation.validator;

import org.springframework.stereotype.Component;

/**
 * `doc` 目录下知识资源 JSON 校验器。
 */
@Component
public class DocResourceJsonTypeValidator extends AbstractLoggingResourceJsonTypeValidator {

    @Override
    public boolean supports(String resourceBizType) {
        return resourceBizType != null && resourceBizType.toUpperCase().startsWith("KG_");
    }
}
