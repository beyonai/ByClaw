package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.CsvSource;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.junit.jupiter.params.provider.ValueSource;

class ModelConfigurationValidatorTest extends I18nTestSupport {
    @ParameterizedTest
    @CsvSource({"zh_CN, 模型管理", "en_US, Admin > Model Management"})
    void configurationErrorUsesRequestLanguage(String language, String expected) {
        I18nUtil.setLocale(language);
        ModelDto model = validModel();
        model.setAuthToken("请用户替换-secret");
        assertThatThrownBy(() -> ModelConfigurationValidator.validate(model))
            .isInstanceOf(ModelConfigurationValidator.InvalidModelConfigurationException.class)
            .hasMessageContaining(expected)
            .hasMessageNotContaining("secret")
            .hasMessageNotContaining("ai.service.model.configuration.invalid");
    }

    private ModelDto validModel() {
        ModelDto model = new ModelDto();
        model.setUrl("http://localhost:8000/v1");
        model.setAuthToken("test-key");
        model.setModelCode("test-model");
        return model;
    }

    @Test
    void acceptsConfiguredLocalEndpoint() {
        assertThatCode(() -> ModelConfigurationValidator.validate(validModel())).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "请用户替换", "secret中文", "secret\nvalue"})
    void rejectsInvalidTokensWithoutExposingThem(String token) {
        ModelDto model = validModel();
        model.setAuthToken(token);
        assertThatThrownBy(() -> ModelConfigurationValidator.validate(model))
            .isInstanceOf(ModelConfigurationValidator.InvalidModelConfigurationException.class)
            .hasMessageContaining("模型管理").hasMessageNotContaining("secret");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"请用户替换", "not-a-url", "file:///tmp/model", "http://"})
    void rejectsInvalidEndpoints(String endpoint) {
        ModelDto model = validModel();
        model.setUrl(endpoint);
        assertThatThrownBy(() -> ModelConfigurationValidator.validate(model))
            .isInstanceOf(ModelConfigurationValidator.InvalidModelConfigurationException.class);
    }

    @Test
    void rejectsMissingModelAndModelCode() {
        assertThatThrownBy(() -> ModelConfigurationValidator.validate(null))
            .hasMessageContaining("模型管理");
        ModelDto model = validModel();
        model.setModelCode(" ");
        assertThatThrownBy(() -> ModelConfigurationValidator.validate(model))
            .hasMessageContaining("模型管理");
    }
}
