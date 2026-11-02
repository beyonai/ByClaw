package com.iwhalecloud.byai.manager.application.service.aimodel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.server.ResponseStatusException;

class ModelHealthApplicationServiceTest {
    private final ByaiAimodelMapper mapper = mock(ByaiAimodelMapper.class);
    private final ModelHealthCache cache = new ModelHealthCache();
    private final ModelHealthApplicationService service = new ModelHealthApplicationService(mapper, cache);
    private ModelHealthRedisFixture redis;

    @org.junit.jupiter.api.BeforeEach void setupRedis() { redis = new ModelHealthRedisFixture(); }

    private HttpServer server;

    @AfterEach void cleanup() {
        CurrentUserHolder.clearLoginInfo();
        redis.close();
        if (server != null) server.stop(0);
    }

    @Test void isolatesPersonalModelsAndReportsMissingConfiguration() {
        login("alice");
        when(mapper.selectByCondition("OOA", null, null, null, null, null, null, 17L, "PERSONAL"))
            .thenReturn(List.of());
        var report = service.check(null);
        assertThat(report.scope()).isEqualTo("PERSONAL");
        assertThat(report.healthy()).isTrue();
        assertThat(report.models()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void personalLoginOnlyChecksLlmEvenWhenAnEmbeddingModelExists(boolean hasEmbedding) {
        login("alice");
        var llm = model("http://127.0.0.1:1");
        var embedding = model("http://127.0.0.1:1");
        embedding.setModelId(43L);
        embedding.setModelType("EMBEDDING");
        when(mapper.selectByCondition("OOA", null, null, null, null, null, null, 17L, "PERSONAL"))
            .thenReturn(hasEmbedding ? List.of(llm, embedding) : List.of(llm));
        var checking = spy(service);
        doReturn(new ModelHealthApplicationService.Item("42", "My model", "LLM", "HEALTHY",
            null, null, 200, true)).when(checking).probe(llm);

        var report = checking.check(null);

        assertThat(report.healthy()).isTrue();
        assertThat(report.models()).extracting(ModelHealthApplicationService.Item::modelType)
            .containsExactly("LLM");
        verify(checking, never()).probe(embedding);
    }

    @Test void adminChecksPublicLlmAndEmbedding() {
        login("AdminVip");
        when(mapper.selectByCondition("OOA", null, null, null, null, null, null, null, "PUBLIC"))
            .thenReturn(List.of());
        assertThat(service.check(null).models()).extracting(ModelHealthApplicationService.Item::modelType)
            .containsExactly("LLM", "EMBEDDING");
    }

    @Test void rejectsOtherUsersAndPublicModelsBeforeMakingAnyProbe() {
        login("alice");
        var model = model("http://127.0.0.1:1");
        model.setOwnerType("PUBLIC");
        when(mapper.selectById(42L)).thenReturn(model);
        assertThatThrownBy(() -> service.check(42L)).isInstanceOf(ResponseStatusException.class);
        model.setOwnerType("PERSONAL"); model.setCreateBy(18L);
        assertThatThrownBy(() -> service.check(42L)).isInstanceOf(ResponseStatusException.class);
    }

    @Test void probesSavedDisabledModelAndReportsSafeNamedAuthenticationFailure() throws Exception {
        AtomicReference<String> body = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", exchange -> {
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"error\":\"do-not-expose-provider-token\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(401, response.length);
            exchange.getResponseBody().write(response); exchange.close();
        });
        server.start(); login("alice");
        var model = model("http://127.0.0.1:" + server.getAddress().getPort());
        model.setStatus("OOX");
        when(mapper.selectById(42L)).thenReturn(model);
        var report = service.check(42L);
        assertThat(report.healthy()).isFalse();
        assertThat(report.models()).singleElement().satisfies(item -> {
            assertThat(item.modelId()).isEqualTo("42");
            assertThat(item.modelName()).isEqualTo("My model");
            assertThat(item.errorCode()).isEqualTo("AUTH_FAILED");
            assertThat(item.httpStatus()).isEqualTo(401);
            assertThat(item.toString()).doesNotContain("do-not-expose-provider-token");
        });
        assertThat(body.get()).contains("\"max_tokens\":16", "Reply OK");
        verify(mapper, never()).updateById(any());
    }

    @Test void validatesResponseBodyInsteadOfTreatingHttp200AsSuccess() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", exchange -> {
            byte[] response = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response); exchange.close();
        });
        server.start();
        assertThat(service.probe(model("http://127.0.0.1:" + server.getAddress().getPort())).errorCode())
            .isEqualTo("INVALID_RESPONSE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"OpenAI", "OpenAI Responses", "Anthropic", "Qwen", "Volcengine Multimodal"})
    void acceptsRealProtocolResponsesWithoutGeneratingMedia(String protocol) throws Exception {
        boolean embedding = protocol.equals("Qwen") || protocol.equals("Volcengine Multimodal");
        String path = embedding ? "/native-embedding" : protocol.equals("Anthropic") ? "/v1/messages"
            : protocol.equals("OpenAI Responses") ? "/responses" : "/chat/completions";
        String response = switch (protocol) {
            case "Qwen" -> "{\"output\":{\"embeddings\":[{\"embedding\":[0.1,0.2]}]}}";
            case "Volcengine Multimodal" -> "{\"data\":[{\"embedding\":[0.1,0.2]}]}";
            case "Anthropic" -> "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"OK\"}}\n\n";
            case "OpenAI Responses" -> "data: {\"type\":\"response.output_text.delta\",\"delta\":\"OK\"}\n\n";
            default -> "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\ndata: [DONE]\n\n";
        };
        AtomicReference<String> requestBody = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(path, exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.getResponseHeaders().set("Content-Type", embedding ? "application/json" : "text/event-stream");
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        var model = model("http://127.0.0.1:" + server.getAddress().getPort() + (embedding ? path : ""));
        if (embedding) model.setModelType("EMBEDDING");
        model.setInParams("{\"modelProtocol\":\"" + protocol + "\"}");
        assertThat(service.probe(model).status()).isEqualTo("HEALTHY");
        if (!embedding) assertThat(requestBody.get()).contains("\"stream\":true", "Reply OK");
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "data: {\"code\":-1,\"data\":null,\"msg\":\"upstream failed\",\"success\":false}\n\n",
        "data: {\"error\":{\"message\":\"upstream failed\"}}\n\n",
        "event: error\ndata: {\"message\":\"upstream failed\"}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\ndata: {\"success\":false}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\ndata: [DONE]\ndata: {\"code\":-1,\"success\":false}\n",
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Check\"}}]}\ndata: {\"error\":{\"message\":\"upstream failed\"}}\n",
        "data: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\"}}\n\n"
    })
    void rejectsHttp200StreamErrorsAndEmptyResponses(String response) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        var item = service.probe(model("http://127.0.0.1:" + server.getAddress().getPort()));
        assertThat(item.status()).isEqualTo("FAILED");
        assertThat(item.errorCode()).isEqualTo("UPSTREAM_ERROR");
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "data: [DONE]\n\n",
        "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\ndata: [DONE]\n\n"
    })
    void distinguishesEmptyStreamsFromProtocolErrors(String response) throws Exception {
        serveStream(response);
        assertThat(service.probe(model(serverUrl())).errorCode()).isEqualTo("EMPTY_RESPONSE");
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Check\"}}]}\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\ndata: [DONE]\n",
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"Check\"}}\n\nevent: message_delta\ndata: {\"delta\":{\"stop_reason\":\"max_tokens\"}}\n\n",
        "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"Check\"}\n\ndata: {\"type\":\"response.incomplete\",\"response\":{\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\ndata: [DONE]\n",
        "data: {\"choices\":\n" + "data: [{\"delta\":{\"content\":\"OK\"}}]}\n\n"
    })
    void acceptsRealInferenceIncludingReasoningAndCompatibleSseFraming(String response) throws Exception {
        serveStream(response);
        assertThat(service.probe(model(serverUrl())).status()).isEqualTo("HEALTHY");
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n",
        "data: {\"type\":\"response.incomplete\",\"response\":{\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n"
    })
    void reportsProbeBudgetExhaustionWithoutBlamingTheProtocol(String response) throws Exception {
        serveStream(response);
        assertThat(service.probe(model(serverUrl())).errorCode()).isEqualTo("PROBE_OUTPUT_LIMIT");
    }

    @ParameterizedTest
    @ValueSource(strings = {"Anthropic", "auto", "deepseek", "bailian", "qwen-chat-template", "openai"})
    void disablesOptionalThinkingWithoutIncreasingCostOrRetrying(String format) throws Exception {
        AtomicReference<com.alibaba.fastjson.JSONObject> request = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            request.set(com.alibaba.fastjson.JSONObject.parseObject(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            byte[] bytes = "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\n".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        var model = model(serverUrl());
        model.setInParams("{\"modelProtocol\":\"" + (format.equals("Anthropic") ? format : "OpenAI")
            + "\",\"reasoningConfig\":{\"enabled\":true,\"compatFormat\":\"" + format + "\"}}");
        assertThat(service.probe(model).status()).isEqualTo("HEALTHY");
        var body = request.get();
        assertThat(body.getInteger("max_tokens")).isEqualTo(16);
        if (List.of("Anthropic", "deepseek").contains(format)) {
            assertThat(body.getJSONObject("thinking").getString("type")).isEqualTo("disabled");
        } else if (List.of("auto", "bailian").contains(format)) {
            assertThat(body.getBoolean("enable_thinking")).isFalse();
        } else if (format.equals("qwen-chat-template")) {
            assertThat(body.getJSONObject("chat_template_kwargs").getBoolean("enable_thinking")).isFalse();
        } else {
            assertThat(body).doesNotContainKeys("enable_thinking", "thinking", "reasoning_effort");
        }
    }

    private String serverUrl() { return "http://127.0.0.1:" + server.getAddress().getPort(); }

    private void serveStream(String response) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
    }

    @Test void nonStreamingSuccessCannotHideAStreamingFailure() throws Exception {
        AtomicReference<String> requestBody = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            requestBody.set(body);
            boolean stream = body.contains("\"stream\":true");
            String response = stream ? "{\"code\":-1,\"data\":null,\"success\":false}"
                : "{\"choices\":[{\"message\":{\"content\":\"OK\"}}]}";
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        var item = service.probe(model("http://127.0.0.1:" + server.getAddress().getPort()));
        assertThat(requestBody.get()).contains("\"stream\":true", "Reply OK", "\"max_tokens\":16");
        assertThat(item.status()).isEqualTo("FAILED");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void dailyResultsAreSharedAcrossServiceInstancesButSavesAlwaysProbe(boolean success) {
        login("alice");
        var model = model("http://127.0.0.1:1"); model.setStatus("OOA");
        when(mapper.selectById(42L)).thenReturn(model);
        when(mapper.selectByCondition("OOA", null, null, null, null, null, null, 17L, "PERSONAL"))
            .thenReturn(List.of(model));
        var first = spy(service);
        doReturn(new ModelHealthApplicationService.Item("42", "My model", "LLM", success ? "HEALTHY" : "FAILED",
            success ? null : "AUTH_FAILED", null, 200, true)).when(first).probe(model);
        var initial = first.check(null);
        var otherWindow = spy(new ModelHealthApplicationService(mapper, new ModelHealthCache()));
        doReturn(initial.models().getFirst()).when(otherWindow).probe(model);
        assertThat(otherWindow.check(null).checkedAt()).isEqualTo(initial.checkedAt());
        verify(otherWindow, never()).probe(any());
        otherWindow.check(42L);
        otherWindow.check(42L);
        verify(otherWindow, times(2)).probe(model);
        assertThat(cache.read("PERSONAL").loginCheckedAt()).isEqualTo(initial.loginCheckedAt());
        cache.update("PERSONAL", null, null, current -> new ModelHealthApplicationService.Report(current.scope(),
            current.checkedAt(), current.healthy(), current.models(), System.currentTimeMillis() - ModelHealthCache.DAY - 1,
            false, false, null));
        otherWindow.check(null);
        verify(otherWindow, times(3)).probe(model);
    }

    @Test void debugAndDeletionInvalidateOldProbesAndPreserveUnrelatedFailures() {
        login("alice");
        var first = model("http://127.0.0.1:1"); first.setStatus("OOA");
        var second = model("http://127.0.0.1:1"); second.setModelId(43L); second.setStatus("OOA");
        when(mapper.selectById(42L)).thenReturn(first);
        when(mapper.selectById(43L)).thenReturn(second);
        long oldLogin = cache.begin("PERSONAL", null);
        long oldDebug = service.beginDebug(42L);
        long newDebug = service.beginDebug(42L);
        assertThat(service.completeDebug(42L, oldDebug, true)).isNull();
        var result = service.completeDebug(42L, newDebug, false);
        assertThat(result.models().getFirst().errorCode()).isEqualTo("DEBUG_FAILED");
        assertThat(result.presented()).isTrue();
        assertThat(cache.update("PERSONAL", null, oldLogin, previous -> { throw new AssertionError("stale login"); })).isNull();
        long other = service.beginDebug(43L);
        service.completeDebug(43L, other, false);
        long deleteTicket = service.beginDebug(42L);
        cache.evict("PERSONAL", 17L, "42");
        assertThat(service.completeDebug(42L, deleteTicket, true)).isNull();
        assertThat(cache.read("PERSONAL").models()).extracting(ModelHealthApplicationService.Item::modelId).containsExactly("43");
        assertThat(cache.read("PERSONAL").loginCheckedAt()).isZero();
    }

    @Test void successfulDebugReplacesTheSameModelsOldFalseNegativeWithoutAnotherInference() {
        login("adminvip");
        var model = model("http://127.0.0.1:1"); model.setOwnerType("PUBLIC");
        when(mapper.selectById(42L)).thenReturn(model);
        long previousLogin = System.currentTimeMillis() - 1000;
        cache.update("PUBLIC", null, null, current -> new ModelHealthApplicationService.Report("PUBLIC",
            previousLogin, false, List.of(
                new ModelHealthApplicationService.Item("42", "GLM", "LLM", "FAILED", "INVALID_RESPONSE", null, 200, true),
                new ModelHealthApplicationService.Item("43", "Other", "LLM", "FAILED", "AUTH_FAILED", null, 401, true)),
            previousLogin, true, true, null));
        var checking = spy(service);
        var result = checking.completeDebug(42L, checking.beginDebug(42L), true);
        assertThat(result.models()).filteredOn(item -> "42".equals(item.modelId()))
            .singleElement().satisfies(item -> {
                assertThat(item.status()).isEqualTo("HEALTHY");
                assertThat(item.errorCode()).isNull();
            });
        assertThat(result.models()).filteredOn(item -> "43".equals(item.modelId()))
            .singleElement().extracting(ModelHealthApplicationService.Item::errorCode).isEqualTo("AUTH_FAILED");
        assertThat(cache.read("PUBLIC").loginCheckedAt()).isEqualTo(previousLogin);
        verify(checking, never()).probe(any());
    }

    @Test void cachedReadPrunesDeletedModelsWithoutProbingAndKeepsTheDailyDeadline() {
        login("alice");
        var model = model("http://127.0.0.1:1");
        when(mapper.selectById(42L)).thenReturn(model);
        long ticket = service.beginDebug(42L);
        service.completeDebug(42L, ticket, false);
        long deadline = cache.read("PERSONAL").loginCheckedAt();
        when(mapper.selectById(42L)).thenReturn(null);
        var report = service.cached("PERSONAL");
        assertThat(report.models()).isEmpty();
        assertThat(report.healthy()).isTrue();
        assertThat(report.loginCheckedAt()).isEqualTo(deadline);
        assertThat(new ModelHealthCache().read("PERSONAL").models()).isEmpty();
    }

    @Test void publicResultsAreSharedButPersonalReportsAndDismissalAreUserScoped() {
        login("adminvip");
        var publicModel = model("http://127.0.0.1:1"); publicModel.setOwnerType("PUBLIC");
        when(mapper.selectById(42L)).thenReturn(publicModel);
        long ticket = service.beginDebug(42L);
        var report = service.completeDebug(42L, ticket, false);
        service.acknowledge("PUBLIC", report.checkedAt(), true);
        assertThat(cache.withNotice(cache.read("PUBLIC"), true).dismissed()).isTrue();
        LoginInfo other = new LoginInfo(); other.setUserId(18L); other.setUserCode("alice");
        CurrentUserHolder.setLoginInfo(other);
        assertThat(service.cached("PUBLIC").models()).hasSize(1);
        assertThat(cache.withNotice(cache.read("PUBLIC"), true).dismissed()).isFalse();
        assertThat(service.cached("PERSONAL")).isNull();
        assertThatThrownBy(() -> service.beginDebug(42L)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.completeDebug(42L, ticket, true)).isInstanceOf(ResponseStatusException.class);
    }

    @Test void staleAcknowledgementCannotDismissANewerFailureAndExistingModelsCannotBePrunedByClients() {
        login("alice");
        var model = model("http://127.0.0.1:1");
        when(mapper.selectById(42L)).thenReturn(model);
        var old = service.completeDebug(42L, service.beginDebug(42L), false);
        var newer = service.completeDebug(42L, service.beginDebug(42L), false);
        service.acknowledge("PERSONAL", old.checkedAt(), true);
        assertThat(cache.withNotice(cache.read("PERSONAL"), true).checkedAt()).isEqualTo(newer.checkedAt());
        service.removeDeleted("42");
        assertThat(cache.read("PERSONAL").models()).hasSize(1);
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.cached("PUBLIC")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.check(null)).isInstanceOf(ResponseStatusException.class);
    }

    private void login(String code) {
        LoginInfo info = new LoginInfo(); info.setUserId(17L); info.setUserCode(code);
        CurrentUserHolder.setLoginInfo(info);
    }
    private ByaiAimodel model(String url) {
        var model = new ByaiAimodel(); model.setModelId(42L); model.setModelName("My model");
        model.setModelNo("test-model"); model.setModelType("LLM"); model.setUrl(url);
        model.setOwnerType("PERSONAL"); model.setCreateBy(17L); return model;
    }
}
