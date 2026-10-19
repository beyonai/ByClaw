package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThat;

class IntegrationRunMessagesTest extends I18nTestSupport {
    @Test
    void storedSystemReasonsTranslateWithoutChangingIdentifiersOrCustomDetails() {
        LocaleContextHolder.setLocale(Locale.US);
        assertThat(IntegrationRunMessages.localize("执行记录不存在: 9007199254740993"))
            .isEqualTo("Execution record not found: 9007199254740993");
        assertThat(IntegrationRunMessages.localize("套件执行超时: 用户套件"))
            .isEqualTo("Test suite timed out: 用户套件");
        assertThat(IntegrationRunMessages.localize("用户自定义失败原因"))
            .isEqualTo("用户自定义失败原因");
        assertThat(IntegrationRunMessages.localize(null)).isNull();
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        assertThat(IntegrationRunMessages.localize("Test suite timed out: 用户套件"))
            .isEqualTo("套件执行超时: 用户套件");
    }
}
