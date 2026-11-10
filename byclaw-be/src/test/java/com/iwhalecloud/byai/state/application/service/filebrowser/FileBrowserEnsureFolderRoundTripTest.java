package com.iwhalecloud.byai.state.application.service.filebrowser;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeSupport;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;

/** Exercise the real sandbox HTTP provider rather than mocking an optimized implementation. */
class FileBrowserEnsureFolderRoundTripTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    private final Set<String> directories = new HashSet<>();
    private final List<String> reads = new ArrayList<>();
    private final List<String> creates = new ArrayList<>();
    private HttpServer server;
    private FileBrowserApplicationService service;
    private int failureStatus;
    private String filePath;

    @BeforeEach
    void setup() throws Exception {
        directories.add("/");
        ObjectMapper json = new ObjectMapper();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/filebrowser/openclaw-api/", exchange -> {
            int status;
            String body = "{}";
            if (exchange.getRequestURI().getPath().endsWith("/mkdir")) {
                var value = json.readTree(exchange.getRequestBody());
                String parent = value.path("path").asText();
                String path = ("/".equals(parent) ? "" : parent) + "/" + value.path("name").asText();
                creates.add(path);
                if (path.equals(filePath)) status = 409;
                else if (!directories.contains(parent)) status = 404;
                else { status = directories.add(path) ? 200 : 409; }
            } else {
                String path = URLDecoder.decode(exchange.getRequestURI().getRawQuery().substring(5), StandardCharsets.UTF_8);
                path = path.length() > 1 && path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
                reads.add(path);
                status = failureStatus != 0 ? failureStatus : directories.contains(path) || path.equals(filePath) ? 200 : 404;
                body = path.equals(filePath)
                    ? "{\"items\":[{\"name\":\"leaf\",\"path\":\"" + path + "\",\"isDir\":false}]}"
                    : "{\"items\":[]}";
            }
            byte[] response = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        var endpoint = mock(SandboxIngressEndpointResolver.class);
        when(endpoint.resolveRequiredEndpoint("alice", "filebrowser"))
            .thenReturn("http://127.0.0.1:" + server.getAddress().getPort());
        var runtime = mock(SandboxIngressRuntimeResolver.class);
        when(runtime.resolve()).thenReturn(mock(SandboxIngressRuntimeSupport.class, CALLS_REAL_METHODS));
        var provider = new OpenClawFileBrowserProvider(endpoint, runtime, json);
        var factory = mock(FileBrowserProviderFactory.class);
        when(factory.getProvider()).thenReturn(provider);
        service = new FileBrowserApplicationService(factory, mock(ByClawSkillResourceApplicationService.class),
            mock(UserFS.class), json);
    }

    @AfterEach
    void cleanup() { server.stop(0); }

    @Test
    void existingNestedSessionNeedsOnlyTheTargetProbe() {
        directories.addAll(List.of("/.sessions", "/.sessions/123", "/.sessions/123/reports"));
        service.ensureFolder("alice", 10L, "/by/.sessions/123/reports/");
        assertThat(reads).containsExactly("/.sessions/123/reports");
        assertThat(creates).isEmpty();
    }

    @Test
    void missingNestedSessionStillCreatesParentsInOrder() {
        service.ensureFolder("alice", 10L, "/by/.sessions/123/reports/");
        assertThat(creates).containsExactly("/.sessions", "/.sessions/123", "/.sessions/123/reports");
        assertThat(directories).contains("/.sessions/123/reports");
    }

    @Test
    void targetFileCannotBecomeAnEnsuredDirectory() {
        directories.addAll(List.of("/.sessions", "/.sessions/123"));
        filePath = "/.sessions/123/reports";
        assertThatThrownBy(() -> service.ensureFolder("alice", 10L, "/by/.sessions/123/reports/"))
            .isInstanceOf(RuntimeException.class);
        assertThat(directories).doesNotContain(filePath);
    }

    @Test
    void deniedOrFailedTargetProbeDoesNotCreateDirectories() {
        for (int status : List.of(401, 403, 500, 503)) {
            failureStatus = status;
            assertThatThrownBy(() -> service.ensureFolder("alice", 10L, "/by/.sessions/123/reports/"))
                .isInstanceOf(RuntimeException.class).hasMessageContaining(String.valueOf(status));
        }
        assertThat(creates).isEmpty();
    }
}
