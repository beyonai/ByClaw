package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;

class SandboxBrowserNavigationServiceTest {

    private static final String USER_CODE = "user-1";
    private static final String SANDBOX_ID = "sandbox-1";
    private static final String SESSION_KEY = "operation-account-1";

    private SandboxService sandboxService;
    private SandboxIngressRuntimeResolver runtimeResolver;
    private SandboxBrowserNavigationService navigationService;

    @BeforeEach
    void setUp() {
        sandboxService = mock(SandboxService.class);
        runtimeResolver = mock(SandboxIngressRuntimeResolver.class);
        navigationService = new SandboxBrowserNavigationService(sandboxService, runtimeResolver);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "https://www.zhihu.com/",
        "http://localhost:3000/login",
        "http://10.0.0.12:8080/login",
        "http://service.internal:8080/login",
        "http://[::1]:3000/login"
    })
    void navigate_acceptsHttpAndHttpsUrlsWithAnyHost(String targetUrl) {
        when(sandboxService.sandboxInfo(USER_CODE)).thenReturn(List.of());

        assertThatThrownBy(() -> navigationService.navigate(USER_CODE, SANDBOX_ID, targetUrl, SESSION_KEY))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Sandbox does not belong to current user");

        verify(sandboxService).sandboxInfo(USER_CODE);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "file:///tmp/login.html",
        "javascript:alert(1)",
        "data:text/html,login"
    })
    void navigate_rejectsNonHttpProtocols(String targetUrl) {
        assertThatThrownBy(() -> navigationService.navigate(USER_CODE, SANDBOX_ID, targetUrl, SESSION_KEY))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("Unsupported operation account login URL");

        verifyNoInteractions(sandboxService);
    }

    @Test
    void navigate_rejectsHttpUrlWithoutHost() {
        assertThatThrownBy(() -> navigationService.navigate(
            USER_CODE, SANDBOX_ID, "https:///login", SESSION_KEY))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("Unsupported operation account login URL");

        verifyNoInteractions(sandboxService);
    }
}
