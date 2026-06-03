package com.iwhalecloud.byai.common.storage.validation.validator;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.storage.validation.ResourceJsonConnectivityValidationService;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidationContext;

/**
 * Toolkit 资源校验器
 * @author qin.guoquan
 * @date 2026-05-23 14:12:18
 */
@Component
public class ToolkitResourceJsonTypeValidator extends AbstractLoggingResourceJsonTypeValidator {

    private final ResourceJsonConnectivityValidationService connectivityValidationService;

    public ToolkitResourceJsonTypeValidator(ResourceJsonConnectivityValidationService connectivityValidationService) {
        this.connectivityValidationService = connectivityValidationService;
    }

    @Override
    public boolean supports(String resourceBizType) {
        return "TOOLKIT".equalsIgnoreCase(resourceBizType);
    }

    @Override
    protected void doValidate(ResourceJsonValidationContext context) {
        connectivityValidationService.validate(context);
    }
}
