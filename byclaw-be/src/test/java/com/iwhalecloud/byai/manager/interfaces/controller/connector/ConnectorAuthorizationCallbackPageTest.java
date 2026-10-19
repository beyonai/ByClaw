package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThat;

class ConnectorAuthorizationCallbackPageTest extends I18nTestSupport {
    @Test
    void callbackPageUsesTheRequestLanguageAndKeepsTheCloseBehavior() {
        assertThat(ConnectorAuthorizationCallbackPage.render(true))
            .contains("lang=\"zh-CN\"", "GitHub 授权成功", "关闭页面", "window.close()");
        LocaleContextHolder.setLocale(Locale.US);
        assertThat(ConnectorAuthorizationCallbackPage.render(false))
            .contains("lang=\"en-US\"", "GitHub authorization incomplete", "Close page", "window.close()")
            .doesNotContain("关闭页面", "GitHub 授权未完成");
    }
}
