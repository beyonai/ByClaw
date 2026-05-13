package com.iwhalecloud.byai.manager.domain.resource.validator.impl;

import java.util.Map;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.manager.dto.resource.ResourceDto;
import com.iwhalecloud.byai.manager.domain.resource.validator.AbstractResourceValidator;

/**
 * 数字员工资源校验器
 */
@Component
public class AgentResourceValidator extends AbstractResourceValidator {

    @Override
    protected void doValidate(ResourceDto resource) {
        Map<String, Object> param = convertToMap(resource.getParam());
        validateParamNotEmpty(param, "agentType");
        validateUrl(param, "agentSseUrl");
        validateUrl(param, "agentAdminUrl");
    }

}