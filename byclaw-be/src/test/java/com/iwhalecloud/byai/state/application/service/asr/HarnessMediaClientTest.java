package com.iwhalecloud.byai.state.application.service.asr;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRequestContext;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeSupport;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.Request;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class HarnessMediaClientTest {
    private HttpServer server;
    private HarnessMediaClient client;
    private final ObjectMapper mapper = new ObjectMapper();
    private final AtomicReference<JsonNode> requestBody = new AtomicReference<>();
    private final AtomicReference<String> token = new AtomicReference<>();
    private final AtomicReference<String> runtimeKey = new AtomicReference<>();
    private String response = "{\"text\":\"识别后的语音\",\"provider\":\"TEST\",\"model\":\"test\"}";
    private int status = 200;

    @BeforeEach
    void setUp() throws Exception {
        LoginInfo login = new LoginInfo();
        login.setUserId(42L);
        login.setUserCode("user42");
        CurrentUserHolder.setLoginInfo(login);
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/sandbox/api/byclaw/", exchange -> {
            requestBody.set(mapper.readTree(exchange.getRequestBody()));
            token.set(exchange.getRequestHeaders().getFirst("Beyond-Token"));
            runtimeKey.set(exchange.getRequestHeaders().getFirst("OPEN-SANDBOX-API-KEY"));
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        var endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/sandbox";
        var endpoints = mock(SandboxIngressEndpointResolver.class);
        when(endpoints.resolveRequiredEndpoint("user42", "openclaw")).thenReturn(endpoint);
        var runtimes = mock(SandboxIngressRuntimeResolver.class);
        when(runtimes.resolve()).thenReturn(new SandboxIngressRuntimeSupport() {
            public boolean supports(String type) { return true; }
            public String baseUrl() { return endpoint; }
            public void customizeRequest(Request.Builder builder, SandboxIngressRequestContext context) {
                assertThat(context.userCode()).isEqualTo("user42");
                builder.header("OPEN-SANDBOX-API-KEY", "runtime-test-key");
            }
        });
        var authorization = mock(HarnessMediaAuthorizationService.class);
        when(authorization.currentToken()).thenReturn("user-session-token");
        client = new HarnessMediaClient(endpoints, runtimes, authorization, mapper, "openclaw");
    }

    @AfterEach
    void cleanup() {
        server.stop(0);
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void delegatesToAuthenticatedUserRuntimeWithoutSendingModelForNormalTranscription() {
        assertThat(client.transcribe(audio(), null)).containsEntry("text", "识别后的语音");
        assertThat(token.get()).isEqualTo("user-session-token");
        assertThat(runtimeKey.get()).isEqualTo("runtime-test-key");
        assertThat(requestBody.get().path("sessionId").asText()).isEqualTo("100");
        assertThat(requestBody.get().has("model")).isFalse();
        assertThat(requestBody.get().has("debug")).isFalse();
        assertThat(requestBody.get().path("audioBase64").asText()).isEqualTo("SUQz");
    }

    @Test
    void explicitModelDebugUsesSameProviderRuntime() {
        client.transcribe(audio(), Map.of("provider", "TEST", "model", "test"));
        assertThat(requestBody.get().path("debug").asBoolean()).isTrue();
        assertThat(requestBody.get().path("model").path("provider").asText()).isEqualTo("TEST");
    }

    @Test
    void failuresAndInvalidSuccessResponsesNeverExposeUpstreamDetails() {
        status = 503;
        response = "provider secret credential and internal endpoint";
        assertThatThrownBy(() -> client.transcribe(audio(), null))
            .hasMessageContaining("502").hasMessageNotContaining("secret credential")
            .isNotInstanceOf(HarnessMediaClient.ModelFailureException.class);
        status = 200;
        response = "{\"text\":\"\"}";
        assertThatThrownBy(() -> client.transcribe(audio(), null)).hasMessageContaining("502");
    }

    @Test
    void knownSilenceFailureGivesASafeActionableMessage() {
        status = 400;
        response = "{\"code\":\"ASR_SPEECH_NOT_DETECTED\",\"message\":\"untrusted provider detail\"}";
        assertThatThrownBy(() -> client.transcribe(audio(), null))
            .hasMessageContaining("422").hasMessageContaining("未识别到语音，请靠近麦克风后重试")
            .hasMessageNotContaining("untrusted provider detail")
            .isNotInstanceOf(HarnessMediaClient.ModelFailureException.class);
        response = "{\"code\":\"ASR_PROVIDER_REJECTED\",\"message\":\"provider secret\"}";
        assertThatThrownBy(() -> client.transcribe(audio(), null))
            .hasMessageContaining("502").hasMessageNotContaining("provider secret")
            .isNotInstanceOf(HarnessMediaClient.ModelFailureException.class);
        response = "{\"code\":\"ASR_MODEL_CONNECTION_FAILED\"}";
        assertThatThrownBy(() -> client.transcribe(audio(), null))
            .isInstanceOf(HarnessMediaClient.ModelFailureException.class);
    }

    @Test
    void ttsClientInputAndProviderFailuresAreClassifiedSeparately() {
        status = 400;
        response = "{\"code\":\"TTS_TEXT_INVALID\"}";
        assertThatThrownBy(() -> client.debugTts("hello", Map.of("provider", "TEST")))
            .isNotInstanceOf(HarnessMediaClient.ModelFailureException.class);
        response = "{\"code\":\"TTS_SYNTHESIS_FAILED\"}";
        assertThatThrownBy(() -> client.debugTts("hello", Map.of("provider", "TEST")))
            .isNotInstanceOf(HarnessMediaClient.ModelFailureException.class);
        response = "{\"code\":\"TTS_MODEL_CONNECTION_FAILED\"}";
        assertThatThrownBy(() -> client.debugTts("hello", Map.of("provider", "TEST")))
            .isInstanceOf(HarnessMediaClient.ModelFailureException.class);
    }

    @Test
    void genericAsrProviderFailureDoesNotProveTheSavedModelIsInvalid() {
        status = 400;
        response = "{\"code\":\"ASR_PROVIDER_FAILED\"}";
        assertThatThrownBy(() -> client.transcribe(audio(), null))
            .isNotInstanceOf(HarnessMediaClient.ModelFailureException.class);
        response = "{\"code\":\"ASR_AUTH_INCOMPLETE\"}";
        assertThatThrownBy(() -> client.transcribe(audio(), null))
            .isInstanceOf(HarnessMediaClient.ModelFailureException.class);
    }

    @Test
    void ttsDebugValidatesGeneratedAudioAndReturnsCompactMetadata() {
        response = "{\"audioBase64\":\"SUQz\",\"mimeType\":\"audio/mpeg\",\"provider\":\"TEST\",\"model\":\"test\"}";
        var result = client.debugTts("hello", Map.of("provider", "TEST"));
        assertThat(result).containsEntry("success", true).containsEntry("byteLength", 3)
            .doesNotContainKey("audioBase64");
        assertThat(requestBody.get().path("text").asText()).isEqualTo("hello");
        assertThat(requestBody.get().path("debug").asBoolean()).isTrue();
    }

    @Test
    void trustedProcessEndpointOverridePreservesUserAuthentication() {
        org.springframework.test.util.ReflectionTestUtils.setField(client, "endpointOverride",
            "http://127.0.0.1:" + server.getAddress().getPort() + "/sandbox");
        assertThat(client.transcribe(audio(), null)).containsEntry("text", "识别后的语音");
        assertThat(token.get()).isEqualTo("user-session-token");
    }

    @Test
    void rejectsNonHttpProcessOverrides() {
        org.springframework.test.util.ReflectionTestUtils.setField(client, "endpointOverride", "file:///tmp/runtime");
        assertThatThrownBy(() -> client.transcribe(audio(), null)).hasMessageContaining("502");
    }

    private VoiceAudioService.VoiceAudio audio() {
        return new VoiceAudioService.VoiceAudio(1L, 100L, "voice.mp3", new byte[] { 'I', 'D', '3' });
    }
}
