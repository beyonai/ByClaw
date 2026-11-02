package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Set;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.common.integration.security.InternalServicePrincipal;

class TenantContextInterceptorTest {

    private final TenantContextService service = mock(TenantContextService.class);
    private final TenantContextInterceptor interceptor = new TenantContextInterceptor(service);

    @AfterEach
    void clearContext() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void supportedTenantRouteValidatesEnterpriseAgainstCurrentUserMembership() {
        TenantRequestContext context = new TenantRequestContext(1L, 123L, "MEMBER");
        when(service.validate("123")).thenReturn(context);
        MockHttpServletRequest request = request("/byaiService/assiman/getMessages", "123");

        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object())).isTrue();
        verify(service).validate("123");
        assertThat(TenantRequestContextHolder.get()).isSameAs(context);
    }

    @Test
    void oldTenantContextHeaderIsRejectedInsteadOfBeingUsedAsAuthorization() {
        MockHttpServletRequest request = request("/byaiService/assiman/getMessages", "123");
        request.addHeader("X-Tenant-Context", "old-token");

        assertThatThrownBy(() -> interceptor.preHandle(request, new MockHttpServletResponse(), new Object()))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("tenant.context.header.removed");
        verifyNoInteractions(service);
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    @Test
    void missingEnterpriseKeepsLegacyPersonalFlowWithoutCreatingTenantContext() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/byaiService/assiman/getMessages");
        request.setContextPath("/byaiService");

        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object())).isTrue();
        verifyNoInteractions(service);
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    @Test
    void tenantHeaderCannotReachUnmappedBusinessRoute() {
        MockHttpServletRequest request = request("/byaiService/chat/sessions", "123");

        assertThatThrownBy(() -> interceptor.preHandle(request, new MockHttpServletResponse(), new Object()))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("tenant.route.notReady");
        verifyNoInteractions(service);
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    @Test
    void servicePrincipalIsCheckedByItsOwnTenantAllowList() {
        MockHttpServletRequest request = request("/byaiService/internal/v1/tenants/123", "123");
        request.setAttribute(InternalServicePrincipal.ATTRIBUTE,
            new InternalServicePrincipal("client", "HACU", Set.of("tenant:read"), Set.of("123"), false));

        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object())).isTrue();
        verifyNoInteractions(service);
        assertThat(TenantRequestContextHolder.get()).isNull();
    }

    @Test
    void afterCompletionClearsValidatedTenantContext() {
        TenantRequestContext context = new TenantRequestContext(1L, 123L, "MEMBER");
        when(service.validate("123")).thenReturn(context);
        MockHttpServletRequest request = request("/byaiService/assiman/getMessages", "123");
        MockHttpServletResponse response = new MockHttpServletResponse();

        interceptor.preHandle(request, response, new Object());
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
