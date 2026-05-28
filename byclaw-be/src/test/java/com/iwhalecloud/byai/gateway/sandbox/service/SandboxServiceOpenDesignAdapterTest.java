package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenDesignClient;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignRedirectResult;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

class SandboxServiceOpenDesignAdapterTest {

    private OpenDesignRedirectService openDesignRedirectService;
    private SandboxProperties sandboxProperties;
    private HttpServer server;
    private String daemonBaseUrl;
    private final List<String> requestLog = new ArrayList<>();

    @BeforeEach
    void setUp() throws IOException {
        sandboxProperties = new SandboxProperties();
        openDesignRedirectService = new OpenDesignRedirectService(sandboxProperties, new OpenDesignClient());

        server = HttpServer.create(new InetSocketAddress(0), 0);
        daemonBaseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        server.start();
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void prepareOpenDesignRedirect_redirectsExistingProjectWithoutCreatingRun() {
        server.createContext("/api/health", exchange -> writeJson(exchange, 200, "{\"ok\":true}"));
        server.createContext("/api/projects/existing-session", exchange -> {
            requestLog.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            writeJson(exchange, 200, "{\"project\":{\"id\":\"existing-session\"}}");
        });

        Map<String, Object> params = new HashMap<>();
        params.put("sessionId", "existing-session");
        params.put("conversationId", "conversation-1");
        params.put("daemonBaseUrl", daemonBaseUrl);
        params.put("webBaseUrl", "http://example.com/open-design");
        params.put("prompt", "should be ignored when project exists");

        OpenDesignRedirectResult result = openDesignRedirectService.prepareRedirect(params);

        assertThat(result.getTargetUrl())
            .isEqualTo("/openDesign/projects/existing-session/conversations/conversation-1");
        assertThat(requestLog).containsExactly("GET /api/projects/existing-session");
    }

    @Test
    void prepareOpenDesignRedirect_createsProjectMessagesAndRunForNewPromptedSession() {
        server.createContext("/api/health", exchange -> writeJson(exchange, 200, "{\"ok\":true}"));
        server.createContext("/api/projects/new-session", exchange -> {
            requestLog.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            writeJson(exchange, 404, "{\"message\":\"not found\"}");
        });
        server.createContext("/api/projects", exchange -> {
            requestLog.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            if ("POST".equals(exchange.getRequestMethod())) {
                writeJson(exchange, 200, "{\"conversationId\":\"conv-1\"}");
                return;
            }
            writeJson(exchange, 405, "{\"message\":\"method not allowed\"}");
        });
        server.createContext("/api/projects/new-session/conversations/conv-1", exchange -> {
            requestLog.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            writeJson(exchange, 200, "{\"ok\":true}");
        });
        server.createContext("/api/projects/new-session/conversations/conv-1/messages/user-1", exchange -> {
            requestLog.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            writeJson(exchange, 200, "{\"ok\":true}");
        });
        server.createContext("/api/projects/new-session/conversations/conv-1/messages/assistant-1", exchange -> {
            requestLog.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            writeJson(exchange, 200, "{\"ok\":true}");
        });
        server.createContext("/api/runs", exchange -> {
            requestLog.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            writeJson(exchange, 200, "{\"runId\":\"run-1\"}");
        });

        Map<String, Object> params = new HashMap<>();
        params.put("sessionId", "new-session");
        params.put("daemonBaseUrl", daemonBaseUrl);
        params.put("webBaseUrl", "http://example.com/open-design");
        params.put("agentId", "agent-1");
        params.put("prompt", "build a pricing page");
        params.put("userMessageId", "user-1");
        params.put("assistantMessageId", "assistant-1");

        OpenDesignRedirectResult result = openDesignRedirectService.prepareRedirect(params);

        assertThat(result.getTargetUrl())
            .isEqualTo("/openDesign/projects/new-session/conversations/conv-1");
        assertThat(requestLog).containsExactly(
            "GET /api/projects/new-session",
            "POST /api/projects",
            "PATCH /api/projects/new-session/conversations/conv-1",
            "PUT /api/projects/new-session/conversations/conv-1/messages/user-1",
            "PUT /api/projects/new-session/conversations/conv-1/messages/assistant-1",
            "POST /api/runs",
            "PUT /api/projects/new-session/conversations/conv-1/messages/assistant-1"
        );
    }

    private void writeJson(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream outputStream = exchange.getResponseBody()) {
            outputStream.write(bytes);
        }
        finally {
            exchange.close();
        }
    }
}
