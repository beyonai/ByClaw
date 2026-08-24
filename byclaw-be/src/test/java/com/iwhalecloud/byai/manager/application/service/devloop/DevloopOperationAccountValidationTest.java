package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.dto.devloop.OperationAccountDTO;

class DevloopOperationAccountValidationTest {

    private static MessageSource originalMessageSource;

    private final DevloopApplicationService service = new DevloopApplicationService();

    @BeforeAll
    static void setUpMessageSource() {
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("devloop.operationAccount.field.required", Locale.getDefault(), "required");
        messageSource.addMessage("devloop.operationAccount.field.length.invalid", Locale.getDefault(), "too long");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
    }

    @AfterAll
    static void restoreMessageSource() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
    }

    private String validateCustomLink(String accountName) {
        OperationAccountDTO dto = new OperationAccountDTO();
        dto.setPlatformCode("CustomLink");
        dto.setAccountName(accountName);
        dto.setCustomUrl("https://www.zhihu.com/creator");
        return ReflectionTestUtils.invokeMethod(service, "validateOperationAccount", dto, false);
    }

    @Test
    void rejectsCustomLinkWithoutAccountName() {
        assertThat(validateCustomLink("  ")).isNotNull();
    }

    @Test
    void rejectsCustomLinkWithOverlongAccountName() {
        assertThat(validateCustomLink("a".repeat(101))).isNotNull();
    }

    @Test
    void acceptsCustomLinkWithAccountName() {
        assertThat(validateCustomLink("知乎运营后台")).isNull();
    }
}
