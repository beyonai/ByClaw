package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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

    @ParameterizedTest
    @ValueSource(strings = {"/chat/superAgentChat", "/chat/runningStatus", "/chat/runningSnapshot",
        "/api/v1/sessionResources/query", "/chat/stopChat", "/chat/getMessageById", "/chat/updateMessageStructById", "/chat/sessionStatus"})
    void supportedChatRoutesReceiveValidatedTenantContext(String path) {
        TenantRequestContext context = new TenantRequestContext(1L, 123L, "MEMBER");
        when(service.validate("123", "context-token")).thenReturn(context);
        MockHttpServletRequest request = request("/byaiService" + path, "123");
        request.addHeader("X-Tenant-Context", "context-token");

        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object())).isTrue();
        assertThat(TenantRequestContextHolder.get()).isSameAs(context);
    }

    @ParameterizedTest
    @ValueSource(strings = {"/group-chat/tasks/50", "/group-chat/tasks/50/delivery-status",
        "/group-chat/tasks/50/pending-publication", "/group-chat/tasks/50/complete", "/group-chat/tasks/50/cancel"})
    void groupTaskRoutesReceiveValidatedTenantContext(String path) {
        TenantRequestContext context = new TenantRequestContext(1L, 123L, "MEMBER");
        when(service.validate("123", "context-token")).thenReturn(context);
        MockHttpServletRequest request = request("/byaiService" + path, "123");
        request.addHeader("X-Tenant-Context", "context-token");

        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object())).isTrue();
        assertThat(TenantRequestContextHolder.get()).isSameAs(context);
    }

    @ParameterizedTest
    @ValueSource(strings = {"/group-chat/other", "/group-chat/tasks-other/50"})
    void groupTaskAllowanceDoesNotPermitUnmappedSiblingRoutes(String path) {
        MockHttpServletRequest request = request("/byaiService" + path, "123");
        request.addHeader("X-Tenant-Context", "context-token");
        assertThatThrownBy(() -> interceptor.preHandle(request, new MockHttpServletResponse(), new Object()))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("tenant route is not ready");
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    @Test
    void tenantHeaderCannotReachUnmappedBusinessRoute() {
        MockHttpServletRequest request = request("/byaiService/chat/sessions", "123");
        request.addHeader("X-Tenant-Context", "context-token");
        assertThatThrownBy(() -> interceptor.preHandle(request, new MockHttpServletResponse(), new Object()))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("tenant route is not ready");
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    @Test
    void validatedTenantRouteSetsAndClearsContext() {
        TenantRequestContext context = new TenantRequestContext(1L, 123L, "MEMBER");
        when(service.validate("123", "context-token")).thenReturn(context);
        MockHttpServletRequest request = request("/byaiService/assiman/getMessages", "123");
        request.addHeader("X-Tenant-Context", "context-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThat(interceptor.preHandle(request, response, new Object())).isTrue();
        assertThat(TenantRequestContextHolder.get()).isSameAs(context);
        interceptor.afterCompletion(request, response, new Object(), null);
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    @Test
    void projectSessionListAcceptsValidatedTenantContext() {
        TenantRequestContext context = new TenantRequestContext(1L, 123L, "MEMBER");
        when(service.validate("123", "context-token")).thenReturn(context);
        MockHttpServletRequest request = request("/byaiService/project/session/listByQo", "123");
        request.addHeader("X-Tenant-Context", "context-token");
        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object())).isTrue();
        assertThat(TenantRequestContextHolder.get()).isSameAs(context);
    }

    @Test
    void existingChatRouteRequiresBothEnterpriseAndContextToken() {
        MockHttpServletRequest missingToken = request("/byaiService/assiman/getMessages", "123");
        assertThatThrownBy(() -> interceptor.preHandle(missingToken, new MockHttpServletResponse(), new Object()))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("401");

        MockHttpServletRequest missingEnterprise = new MockHttpServletRequest("GET",
            "/byaiService/assiman/getMessages");
        missingEnterprise.setContextPath("/byaiService");
        assertThat(interceptor.preHandle(missingEnterprise, new MockHttpServletResponse(), new Object())).isTrue();
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    private MockHttpServletRequest request(String path, String enterpriseId) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        request.setContextPath("/byaiService");
        request.addHeader("X-Enterprise-Id", enterpriseId);
        return request;
    }
}
