package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Locale;

import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

import static org.assertj.core.api.Assertions.assertThat;

class ModelErrorPresentationServiceTest extends I18nTestSupport {

    private final ModelErrorPresentationService service = new ModelErrorPresentationService();

    @Test
    void present_mapsSupportedModelErrorCodes() {
        assertThat(present("AUTH")).isEqualTo(I18nUtil.get("model.request.error.auth"));
        assertThat(present("RATE_LIMIT")).isEqualTo(I18nUtil.get("model.request.error.rate.limit"));
        assertThat(present("QUOTA_EXCEEDED")).isEqualTo(I18nUtil.get("model.request.error.quota.exceeded"));
        assertThat(present("TIMEOUT")).isEqualTo(I18nUtil.get("model.request.error.timeout"));
        assertThat(present("CONTEXT_LENGTH")).isEqualTo(I18nUtil.get("model.request.error.context.length"));
        assertThat(present("SERVER")).isEqualTo(I18nUtil.get("model.request.error.server"));
        assertThat(present("NO_ADAPTER")).isEqualTo(I18nUtil.get("model.request.error.no.adapter"));
        assertThat(present("TRANSPORT")).isEqualTo(I18nUtil.get("model.request.error.transport"));
        assertThat(present("INVALID_REQUEST")).isEqualTo(I18nUtil.get("model.request.error.invalid.request"));
    }

    @Test
    void present_keepsBusinessErrorUnchanged() {
        JSONObject metadata = new JSONObject();
        metadata.put("error_domain", "BUSINESS");
        metadata.put("error_code", "MEMBERSHIP_REQUIRED");

        assertThat(service.present(metadata, "tenant membership required"))
            .isEqualTo("tenant membership required");
    }

    @Test
    void present_unknownErrorDoesNotExposeProviderDetails() {
        JSONObject metadata = new JSONObject();
        metadata.put("error_domain", "MODEL");
        metadata.put("error_code", "UNKNOWN");
        metadata.put("provider_code", "vendor.code<script>");
        metadata.put("provider_message", "raw vendor json must not be rendered");

        String message = service.present(metadata, "fallback");

        assertThat(message).isEqualTo(I18nUtil.get("model.request.error.unknown"));
        assertThat(message).doesNotContain("vendor.code", "raw vendor json", "<", ">");
    }

    @Test
    void present_usesEnglishMessagesForEnglishLocale() {
        LocaleContextHolder.setLocale(Locale.US);

        assertThat(present("AUTH"))
            .isEqualTo("Model credentials are invalid, expired, or lack access. Check the model API Key in Model Management.");
        assertThat(present("UNKNOWN"))
            .isEqualTo("The model service returned an unrecognized error. Check the model configuration and service status, or contact an administrator.");
    }

    private String present(String code) {
        JSONObject metadata = new JSONObject();
        metadata.put("error_domain", "MODEL");
        metadata.put("error_code", code);
        return service.present(metadata, "fallback");
    }
}
