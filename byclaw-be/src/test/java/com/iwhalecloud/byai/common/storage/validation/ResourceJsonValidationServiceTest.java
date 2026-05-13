package com.iwhalecloud.byai.common.storage.validation;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import com.iwhalecloud.byai.common.storage.validation.validator.DocResourceJsonTypeValidator;
import com.iwhalecloud.byai.common.storage.validation.validator.DefaultResourceJsonTypeValidator;
import com.iwhalecloud.byai.common.storage.validation.validator.DigEmployeeResourceJsonTypeValidator;
import com.iwhalecloud.byai.common.storage.validation.validator.ObjectResourceJsonTypeValidator;
import com.iwhalecloud.byai.common.storage.validation.validator.ToolkitResourceJsonTypeValidator;
import com.iwhalecloud.byai.common.storage.validation.validator.ViewResourceJsonTypeValidator;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;

class ResourceJsonValidationServiceTest {

    private final ResourceJsonValidationMessages messages = new ResourceJsonValidationMessages(messageSource());

    private final DefaultResourceJsonTypeValidator defaultValidator = new DefaultResourceJsonTypeValidator();

    private final ResourceJsonValidationService service = new ResourceJsonValidationService(
        new ResourceJsonPathParser(),
        new ResourceJsonContentExtractor(messages),
        new ResourceJsonValidatorRouter(List.of(
            new DigEmployeeResourceJsonTypeValidator(),
            new DocResourceJsonTypeValidator(),
            new ObjectResourceJsonTypeValidator(),
            new ToolkitResourceJsonTypeValidator(),
            new ViewResourceJsonTypeValidator(),
            defaultValidator), defaultValidator),
        new ObjectMapper(),
        messages);

    @BeforeEach
    void setLocale() {
        LocaleContextHolder.setLocale(Locale.CHINA);
    }

    @Test
    void validateIfResourceJson_whenStandardResourceJsonPath_parsesJson() {
        MultipartFileUtil file = file("TOOLKIT_1.json", "{\"resourceId\":1}");

        assertThatCode(() -> service.validateIfResourceJson(file, "/resource/toolkit/"))
            .doesNotThrowAnyException();
    }

    @Test
    void validateIfResourceJson_whenKnowledgeResourceJsonPath_parsesJson() {
        MultipartFileUtil file = file("KG_DOC_1.json", "{\"resourceId\":1}");

        assertThatCode(() -> service.validateIfResourceJson(file, "/resource/doc/"))
            .doesNotThrowAnyException();
    }

    @Test
    void validateIfResourceJson_whenDigEmployeeResourceJsonPath_parsesJson() {
        MultipartFileUtil file = file("DIG_EMPLOYEE_1.json", "{\"resourceId\":1}");

        assertThatCode(() -> service.validateIfResourceJson(file, "/resource/dig_employee/"))
            .doesNotThrowAnyException();
    }

    @Test
    void validateIfResourceJson_whenObjectResourceJsonPath_parsesJson() {
        MultipartFileUtil file = file("OBJECT_1.json", "{\"resourceId\":1}");

        assertThatCode(() -> service.validateIfResourceJson(file, "/resource/object/"))
            .doesNotThrowAnyException();
    }

    @Test
    void validateIfResourceJson_whenViewResourceJsonPath_parsesJson() {
        MultipartFileUtil file = file("VIEW_1.json", "{\"resourceId\":1}");

        assertThatCode(() -> service.validateIfResourceJson(file, "/resource/view/"))
            .doesNotThrowAnyException();
    }

    @Test
    void validateIfResourceJson_whenNoSpecificValidator_usesDefaultValidator() {
        MultipartFileUtil file = file("AGENT_1.json", "{\"resourceId\":1}");

        assertThatCode(() -> service.validateIfResourceJson(file, "/resource/agent/"))
            .doesNotThrowAnyException();
    }

    @Test
    void validateIfResourceJson_whenInvalidJson_throwsException() {
        MultipartFileUtil file = file("TOOLKIT_1.json", "{invalid");

        assertThatThrownBy(() -> service.validateIfResourceJson(file, "/resource/toolkit/"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("资源JSON内容解析失败");
    }

    @Test
    void validateIfResourceJson_whenNonResourceJsonPath_skipsValidation() {
        MultipartFileUtil file = file("readme.md", "not json");

        assertThatCode(() -> service.validateIfResourceJson(file, "/resource/toolkit/readme.md"))
            .doesNotThrowAnyException();
    }

    @Test
    void validateIfResourceJson_whenMismatchedResourcePath_skipsValidation() {
        MultipartFileUtil file = file("MCP_1.json", "not json");

        assertThatCode(() -> service.validateIfResourceJson(file, "/resource/toolkit/"))
            .doesNotThrowAnyException();
    }

    private MultipartFileUtil file(String name, String content) {
        return new MultipartFileUtil(name, name, "application/json", content.getBytes(StandardCharsets.UTF_8));
    }

    private StaticMessageSource messageSource() {
        StaticMessageSource messageSource = new StaticMessageSource();
        addMessage(messageSource, "resource.json.file.empty", "资源JSON文件不能为空: {0}");
        addMessage(messageSource, "resource.json.content.read.failed", "资源JSON内容读取失败: {0}");
        addMessage(messageSource, "resource.json.object.required", "资源JSON内容必须是JSON对象: {0}");
        addMessage(messageSource, "resource.json.parse.failed", "资源JSON内容解析失败: {0}");
        return messageSource;
    }

    private void addMessage(StaticMessageSource messageSource, String key, String message) {
        messageSource.addMessage(key, Locale.CHINA, message);
        messageSource.addMessage(key, Locale.SIMPLIFIED_CHINESE, message);
    }
}
