package com.iwhalecloud.byai.state.infrastructure.utils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;

class ChatUtilsTest {

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void getLanguage_returnsRequestAttributeWhenPresent() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(I18nUtil.LANGUAGE, "en-US");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(ChatUtils.getLanguage()).isEqualTo("en-US");
    }

    @Test
    void getLanguage_returnsRequestAttributeForPostRequestWhenHeaderMissing() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/chat/superAgentChat");
        request.setAttribute(I18nUtil.LANGUAGE, "en-US");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(ChatUtils.getLanguage()).isEqualTo("en-US");
    }

    @Test
    void getLanguage_returnsDefaultWhenAttributeMissing() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/chat/superAgentChat");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(ChatUtils.getLanguage()).isEqualTo(I18nUtil.CHINSES);
    }
}
