package com.iwhalecloud.byai.common.storage.validation.validator;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.storage.validation.ResourceJsonConnectivityValidationService;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidationContext;

/**
 * `doc` 目录下知识资源 JSON 校验器。
 */
@Component
public class DocResourceJsonTypeValidator extends AbstractLoggingResourceJsonTypeValidator {

    private final ResourceJsonConnectivityValidationService connectivityValidationService;

    public DocResourceJsonTypeValidator(ResourceJsonConnectivityValidationService connectivityValidationService) {
        this.connectivityValidationService = connectivityValidationService;
    }

    @Override
    public boolean supports(String resourceBizType) {
        return resourceBizType != null && resourceBizType.toUpperCase().startsWith("KG_");
    }

    @Override
    protected void doValidate(ResourceJsonValidationContext context) {
        connectivityValidationService.validate(context);
    }
}
