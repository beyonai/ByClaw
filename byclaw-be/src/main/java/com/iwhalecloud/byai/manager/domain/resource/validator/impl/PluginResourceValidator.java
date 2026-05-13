package com.iwhalecloud.byai.manager.domain.resource.validator.impl;

import com.iwhalecloud.byai.manager.dto.resource.ResourceDto;
import com.iwhalecloud.byai.manager.domain.resource.validator.AbstractResourceValidator;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * 插件资源校验器
 */
@Component
public class PluginResourceValidator extends AbstractResourceValidator {

    @Override
    protected void doValidate(ResourceDto resource) {
        Map<String, Object> param = convertToMap(resource.getParam());
        validateParamNotEmpty(param, "headers");

        if (param.containsKey("tools")) {
            Object tools = param.get("tools");
            if (tools != null && !(tools instanceof List)) {
                throw new ByAiArgumentException(I18nUtil.get("pluginresource.validator.tools.array"));
            }
        }
    }

}