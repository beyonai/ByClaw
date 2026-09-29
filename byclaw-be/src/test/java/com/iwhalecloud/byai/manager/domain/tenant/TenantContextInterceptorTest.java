package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;

class TenantContextInterceptorTest {

    private final TenantContextService service = mock(TenantContextService.class);
    private final TenantContextInterceptor interceptor = new TenantContextInterceptor(service);

    @AfterEach
    void clearContext() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void tenantHeaderCannotReachPersonalBusinessRoute() {
        MockHttpServletRequest request = request("/byaiService/chat/sessions", "123");
        assertThatThrownBy(() -> interceptor.preHandle(request, new MockHttpServletResponse(), new Object()))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("tenant route is not ready");
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    @Test
    void validatedTenantRouteSetsAndClearsContext() {
        TenantRequestContext context = new TenantRequestContext(1L, 123L, "MEMBER");
        when(service.validate("123")).thenReturn(context);
        MockHttpServletRequest request = request("/byaiService/tenantChat/sessions", "123");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThat(interceptor.preHandle(request, response, new Object())).isTrue();
        assertThat(TenantRequestContextHolder.get()).isSameAs(context);
        interceptor.afterCompletion(request, response, new Object(), null);
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    private MockHttpServletRequest request(String path, String enterpriseId) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        request.setContextPath("/byaiService");
        request.addHeader("X-Enterprise-Id", enterpriseId);
        return request;
    }
}
