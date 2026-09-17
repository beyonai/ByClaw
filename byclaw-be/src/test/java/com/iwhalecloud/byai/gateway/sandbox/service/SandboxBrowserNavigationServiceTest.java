package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import org.slf4j.LoggerFactory;

import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeSupport;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.net.httpserver.HttpServer;

class SandboxBrowserNavigationServiceTest {

    private static final String USER_CODE = "user-1";
    private static final String SANDBOX_ID = "sandbox-1";
    private static final String SESSION_KEY = "operation-account-1";

    private SandboxService sandboxService;
    private SandboxIngressRuntimeResolver runtimeResolver;
    private SandboxBrowserNavigationService navigationService;
    private Logger logger;
    private ListAppender<ILoggingEvent> appender;
    private HttpServer server;

    @BeforeEach
    void setUp() {
        sandboxService = mock(SandboxService.class);
        runtimeResolver = mock(SandboxIngressRuntimeResolver.class);
        navigationService = new SandboxBrowserNavigationService(sandboxService, runtimeResolver);
        logger = (Logger)LoggerFactory.getLogger(SandboxBrowserNavigationService.class);
        appender = new ListAppender<>();
        logger.addAppender(appender);
        appender.start();
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
        logger.detachAppender(appender);
        appender.stop();
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

    @Test
    void navigate_logsTraceableStagesWithoutEndpointCredentials() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            byte[] response = "{\"id\":\"daemon-1\",\"ok\":true}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/proxy?token=secret-token";
        when(sandboxService.sandboxInfo(USER_CODE)).thenReturn(List.of(SandboxInfo.builder()
            .sandboxId(SANDBOX_ID)
            .instanceEndpoints(Map.of("bycli", endpoint))
            .build()));
        SandboxIngressRuntimeSupport runtimeSupport = mock(SandboxIngressRuntimeSupport.class);
        when(runtimeResolver.resolve()).thenReturn(runtimeSupport);
        when(runtimeSupport.buildTargetUrl(endpoint, "/command", null))
            .thenCallRealMethod();

        navigationService.navigate(USER_CODE, SANDBOX_ID, "https://example.com/login?ticket=private", SESSION_KEY);

        String messages = appender.list.stream()
            .map(ILoggingEvent::getFormattedMessage)
            .reduce("", (left, right) -> left + "\n" + right);
        assertThat(messages)
            .contains("stage=NAVIGATION_START", "stage=COMMAND_RESULT", "stage=NAVIGATION_SUCCESS")
            .contains("userCode=user-1", "sandboxId=sandbox-1", "sessionKey=operation-account-1")
            .contains("target=https://example.com/login", "endpoint=http://127.0.0.1:")
            .contains("statusCode=200", "ok=true", "operationId=operation_account_")
            .doesNotContain("secret-token", "ticket=private");
    }

    @Test
    void navigate_usesHttp11WithoutH2cUpgrade() throws IOException {
        AtomicReference<String> protocol = new AtomicReference<>();
        AtomicReference<String> upgradeHeader = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            protocol.set(exchange.getProtocol());
            upgradeHeader.set(exchange.getRequestHeaders().getFirst("Upgrade"));
            byte[] response = "{\"id\":\"daemon-1\",\"ok\":true}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
        when(sandboxService.sandboxInfo(USER_CODE)).thenReturn(List.of(SandboxInfo.builder()
            .sandboxId(SANDBOX_ID)
            .instanceEndpoints(Map.of("bycli", endpoint))
            .build()));
        SandboxIngressRuntimeSupport runtimeSupport = mock(SandboxIngressRuntimeSupport.class);
        when(runtimeResolver.resolve()).thenReturn(runtimeSupport);
        when(runtimeSupport.buildTargetUrl(endpoint, "/command", null)).thenCallRealMethod();

        navigationService.navigate(USER_CODE, SANDBOX_ID, "https://example.com/login", SESSION_KEY);

        assertThat(protocol.get()).isEqualTo("HTTP/1.1");
        assertThat(upgradeHeader.get()).isNull();
    }
}
