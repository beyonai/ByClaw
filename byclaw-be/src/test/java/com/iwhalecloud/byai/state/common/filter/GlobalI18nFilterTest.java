package com.iwhalecloud.byai.state.common.filter;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalI18nFilterTest {

    private final GlobalI18nFilter filter = new GlobalI18nFilter();

    @AfterEach
    void tearDown() {
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void doFilterInternal_setsRequestAttributeAndLocaleFromLanguageHeader() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(I18nUtil.LANGUAGE, "en-US");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, response, filterChain);

        assertThat(request.getAttribute(I18nUtil.LANGUAGE)).isEqualTo(new Locale("en", "US"));
        assertThat(filterChain.getRequest().getAttribute(I18nUtil.LANGUAGE)).isEqualTo(new Locale("en", "US"));
        assertThat(LocaleContextHolder.getLocale()).isEqualTo(new Locale("en", "US"));
    }

    @Test
    void doFilterInternal_readsLanguageFromJsonBodyWhenHeaderMissing() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/chat/superAgentChat");
        request.setContentType("application/json");
        request.setCharacterEncoding("UTF-8");
        request.setContent("{\"language\":\"en-US\",\"chatContent\":\"hello\"}".getBytes());
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, response, filterChain);

        assertThat(filterChain.getRequest().getAttribute(I18nUtil.LANGUAGE)).isEqualTo(new Locale("en", "US"));
        assertThat(LocaleContextHolder.getLocale()).isEqualTo(new Locale("en", "US"));
    }

    @Test
    void doFilterInternal_setsRequestAttributeFromGetParameterWhenHeaderMissing() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/chat/superAgentChat");
        request.addParameter(I18nUtil.LANGUAGE, "en-US");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, response, filterChain);

        assertThat(request.getAttribute(I18nUtil.LANGUAGE)).isEqualTo(new Locale("en", "US"));
        assertThat(filterChain.getRequest().getAttribute(I18nUtil.LANGUAGE)).isEqualTo(new Locale("en", "US"));
        assertThat(LocaleContextHolder.getLocale()).isEqualTo(new Locale("en", "US"));
    }

    @Test
    void doFilterInternal_acceptsLocaleRequestAttributeWhenNoHeaderOrParameter() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/chat/superAgentChat");
        request.setAttribute(I18nUtil.LANGUAGE, new Locale("en", "US"));
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, response, filterChain);

        assertThat(request.getAttribute(I18nUtil.LANGUAGE)).isEqualTo(new Locale("en", "US"));
        assertThat(filterChain.getRequest().getAttribute(I18nUtil.LANGUAGE)).isEqualTo(new Locale("en", "US"));
        assertThat(LocaleContextHolder.getLocale()).isEqualTo(new Locale("en", "US"));
    }
}
