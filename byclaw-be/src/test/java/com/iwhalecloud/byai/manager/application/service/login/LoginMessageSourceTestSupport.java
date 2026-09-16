package com.iwhalecloud.byai.manager.application.service.login;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

abstract class LoginMessageSourceTestSupport {
    private Object previousMessageSource;

    @BeforeEach
    void initializeMessages() {
        previousMessageSource = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messages = new StaticMessageSource();
        messages.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
    }

    @AfterEach
    void restoreMessages() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", previousMessageSource);
    }
}
