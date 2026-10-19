package com.iwhalecloud.byai.state.domain.chat.service;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

/** Converts structured DSH model errors into localized user-facing guidance. */
@Service
public class ModelErrorPresentationService {

    private static final String MODEL_DOMAIN = "MODEL";

    public String present(JSONObject metadata, String fallback) {
        if (metadata == null || !MODEL_DOMAIN.equals(metadata.getString("error_domain"))) {
            return fallback;
        }
        String code = StringUtils.upperCase(StringUtils.defaultString(metadata.getString("error_code")));
        String messageKey = switch (code) {
            case "AUTH" -> "model.request.error.auth";
            case "RATE_LIMIT" -> "model.request.error.rate.limit";
            case "QUOTA_EXCEEDED" -> "model.request.error.quota.exceeded";
            case "TIMEOUT" -> "model.request.error.timeout";
            case "CONTEXT_LENGTH" -> "model.request.error.context.length";
            case "SERVER" -> "model.request.error.server";
            case "NO_ADAPTER" -> "model.request.error.no.adapter";
            case "TRANSPORT" -> "model.request.error.transport";
            case "INVALID_REQUEST" -> "model.request.error.invalid.request";
            default -> "model.request.error.unknown";
        };
        return I18nUtil.get(messageKey);
    }
}
