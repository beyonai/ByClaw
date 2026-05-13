package com.iwhalecloud.byai.manager.domain.resource.validator.impl;

import java.util.Map;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.manager.dto.resource.ResourceDto;
import com.iwhalecloud.byai.manager.domain.resource.validator.AbstractResourceValidator;

/**
 * MCP服务资源校验
 */
@Component
public class McpResourceValidator extends AbstractResourceValidator {

    @Override
    protected void doValidate(ResourceDto resource) {
        Map<String, Object> param = convertToMap(resource.getParam());
        validateParamNotEmpty(param, "mcpServiceId");
        validateUrl(param, "mcpServiceUrl");
    }

}