package com.iwhalecloud.byai.manager.domain.aimodel.service;

import java.net.URI;

import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import org.apache.commons.lang3.StringUtils;

/** Validate runtime connection settings without including credentials in errors. */
public final class ModelConfigurationValidator {

    private ModelConfigurationValidator() {
    }

    public static void validate(ModelDto model) {
        if (model == null || missing(model.getUrl()) || missing(model.getAuthToken())
            || missing(model.getModelCode()) || !httpEndpoint(model.getUrl())
            || model.getAuthToken().chars().anyMatch(c -> c < 33 || c > 126)) {
            throw new InvalidModelConfigurationException();
        }
    }

    private static boolean missing(String value) {
        return StringUtils.isBlank(value) || value.contains("请用户替换");
    }

    private static boolean httpEndpoint(String value) {
        try {
            URI uri = URI.create(value);
            return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                && StringUtils.isNotBlank(uri.getHost());
        }
        catch (IllegalArgumentException e) {
            return false;
        }
    }

    public static class InvalidModelConfigurationException extends BdpRuntimeException {
        public InvalidModelConfigurationException() {
            super(I18nUtil.get("ai.service.model.configuration.invalid"));
        }
    }
}
