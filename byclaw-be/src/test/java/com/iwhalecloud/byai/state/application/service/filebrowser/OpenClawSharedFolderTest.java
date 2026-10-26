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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class OpenClawSharedFolderTest {
    private HttpServer server;
    private FileBrowserApplicationService service;
    private final AtomicBoolean exists = new AtomicBoolean();
    private final AtomicInteger parentReads = new AtomicInteger();
    private final AtomicInteger creates = new AtomicInteger();
    private int targetStatus;
    private boolean concurrentCreation;
    private boolean targetIsFile;

    @BeforeEach
    void setup() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/filebrowser/openclaw-api/", exchange -> {
            String body;
            int status;
            if (exchange.getRequestURI().getPath().endsWith("/mkdir")) {
                creates.incrementAndGet();
                boolean alreadyExists = exists.getAndSet(true) || concurrentCreation;
                status = alreadyExists ? 409 : 200;
                body = "{}";
            } else {
                String path = URLDecoder.decode(exchange.getRequestURI().getRawQuery().substring(5), StandardCharsets.UTF_8);
                if ("/".equals(path)) {
                    parentReads.incrementAndGet();
                    status = 403;
                    body = "{\"error\":\"parent is not browsable\"}";
                } else {
                    assertThat(path).isIn("/.shared", "/.shared/");
                    status = targetStatus != 0 ? targetStatus : exists.get() ? 200 : 404;
                    body = targetIsFile
                        ? "{\"items\":[{\"name\":\".shared\",\"path\":\"/.shared\",\"isDir\":false,\"size\":1,\"modified\":0}]}"
                        : "{\"items\":[]}";
                }
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
        var mapper = new ObjectMapper();
        var provider = new OpenClawFileBrowserProvider(endpoint, runtime, mapper);
        var factory = mock(FileBrowserProviderFactory.class);
        when(factory.getProvider()).thenReturn(provider);
        service = new FileBrowserApplicationService(factory, mock(ByClawSkillResourceApplicationService.class),
            mock(UserFS.class), mapper);
    }

    @AfterEach
    void cleanup() {
        server.stop(0);
    }

    @Test
    void existingSharedDirectoryDoesNotRequireRootEnumerationOrCreation() {
        exists.set(true);
        service.ensureFolder("alice", 10L, "/by/.shared/");
        assertThat(parentReads).hasValue(0);
        assertThat(creates).hasValue(0);
    }

    @Test
    void missingSharedDirectoryIsCreatedOnceAndCanBeEnsuredAgain() {
        service.ensureFolder("alice", 10L, "/by/.shared/");
        service.ensureFolder("alice", 10L, "/by/.shared/");
        assertThat(exists).isTrue();
        assertThat(creates).hasValue(1);
        assertThat(parentReads).hasValue(0);
    }

    @Test
    void concurrentCreationIsAcceptedAfterCheckingTheTargetDirectory() {
        concurrentCreation = true;
        service.ensureFolder("alice", 10L, "/by/.shared/");
        assertThat(creates).hasValue(1);
    }

    @Test
    void sameNameFileCannotBeAcceptedAsTheSharedDirectory() {
        exists.set(true);
        targetIsFile = true;
        assertThatThrownBy(() -> service.ensureFolder("alice", 10L, "/by/.shared/"))
            .isInstanceOf(RuntimeException.class);
        assertThat(creates).hasValue(1);
    }

    @ParameterizedTest
    @ValueSource(ints = {401, 403, 500, 503})
    void sandboxFailureIsNotTreatedAsAMissingDirectory(int status) {
        targetStatus = status;
        assertThatThrownBy(() -> service.ensureFolder("alice", 10L, "/by/.shared/"))
            .isInstanceOf(RuntimeException.class).hasMessageContaining(String.valueOf(status));
        assertThat(creates).hasValue(0);
    }
}
