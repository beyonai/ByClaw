package com.iwhalecloud.byai.state.application.service.asr;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressInstanceType;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRequestContext;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import java.io.IOException;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Delegate provider selection and speech protocols to the authenticated Harness media plugins. */
@Service
public class HarnessMediaClient {
    private final SandboxIngressEndpointResolver endpoints;
    private final SandboxIngressRuntimeResolver runtimes;
    private final HarnessMediaAuthorizationService authorization;
    private final ObjectMapper mapper;
    private final String instance;
    /** Trusted process configuration for an isolated runtime; never accepted in client requests. */
    @Value("${media.sandbox.endpoint:}")
    private String endpointOverride;
    private final OkHttpClient http = new OkHttpClient.Builder().connectTimeout(Duration.ofSeconds(15))
        .callTimeout(Duration.ofSeconds(120)).readTimeout(Duration.ofSeconds(120)).build();

    public HarnessMediaClient(SandboxIngressEndpointResolver endpoints, SandboxIngressRuntimeResolver runtimes,
        HarnessMediaAuthorizationService authorization, ObjectMapper mapper,
        @Value("${asr.sandbox.instance:openclaw}") String instance) {
        this.endpoints = endpoints;
        this.runtimes = runtimes;
        this.authorization = authorization;
        this.mapper = mapper;
        this.instance = instance;
    }

    public Map<String, Object> transcribe(VoiceAudioService.VoiceAudio audio, Map<String, Object> model) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("audioBase64", Base64.getEncoder().encodeToString(audio.bytes()));
        body.put("fileName", audio.fileName());
        body.put("mimeType", "audio/mpeg");
        if (audio.sessionId() != null) body.put("sessionId", audio.sessionId().toString());
        if (model != null) {
            body.put("model", model);
            body.put("debug", true);
        }
        JsonNode result = invoke("/api/byclaw/asr/transcribe", body, 1024 * 1024);
        if (!result.path("text").isTextual() || result.path("text").asText().isBlank()) throw unavailable();
        return Map.of("text", result.path("text").asText());
    }

    public Map<String, Object> debugTts(String text, Map<String, Object> model) {
        JsonNode result = invoke("/api/byclaw/tts/debug", Map.of("text", text, "model", model, "debug", true),
            VoiceAudioService.MAX_AUDIO_BYTES * 4 / 3 + 65536);
        String mimeType = result.path("mimeType").asText();
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(result.path("audioBase64").asText());
        } catch (IllegalArgumentException e) {
            throw unavailable();
        }
        if (!mimeType.startsWith("audio/") || bytes.length == 0 || bytes.length > VoiceAudioService.MAX_AUDIO_BYTES) {
            throw unavailable();
        }
        return Map.of("success", true, "mimeType", mimeType, "byteLength", bytes.length,
            "provider", result.path("provider").asText(), "model", result.path("model").asText());
    }

    private JsonNode invoke(String path, Map<String, Object> body, int maxResponseBytes) {
        var login = CurrentUserHolder.getLoginInfo();
        if (login == null || login.getUserCode() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
        }
        String token = authorization.currentToken();
        try {
            String endpoint = resolveEndpoint(login.getUserCode());
            var runtime = runtimes.resolve();
            var target = runtime.buildTargetUrl(endpoint, path, null);
            Request.Builder builder = new Request.Builder().url(target).header("Beyond-Token", token)
                .post(RequestBody.create(mapper.writeValueAsBytes(body), MediaType.get("application/json")));
            runtime.customizeRequest(builder, new SandboxIngressRequestContext(SandboxIngressInstanceType.UNKNOWN,
                instance, login.getUserCode(), endpoint, "POST", path, null, target, token, login, Map.of()));
            try (Response response = http.newCall(builder.build()).execute()) {
                if (response.body() == null) throw unavailable();
                byte[] bytes = response.body().byteStream().readNBytes(maxResponseBytes + 1);
                if (bytes.length > maxResponseBytes) throw unavailable();
                if (!response.isSuccessful()) {
                    if (path.equals("/api/byclaw/asr/transcribe")
                        && (response.code() == 400 || response.code() == 422)) {
                        JsonNode failure = mapper.readTree(bytes);
                        if (failure != null && "ASR_SPEECH_NOT_DETECTED".equals(failure.path("code").asText())) {
                            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                                "未识别到语音，请靠近麦克风后重试");
                        }
                        if (failure != null && java.util.Set.of("ASR_MODEL_CONNECTION_FAILED",
                            "ASR_PROVIDER_UNSUPPORTED", "ASR_PROTOCOL_MISMATCH", "ASR_AUTH_REQUIRED",
                            "ASR_AUTH_INCOMPLETE").contains(failure.path("code").asText())) {
                            throw new ModelFailureException();
                        }
                    } else if (path.equals("/api/byclaw/tts/debug") && response.code() == 400) {
                        JsonNode failure = mapper.readTree(bytes);
                        if (failure != null && "TTS_MODEL_CONNECTION_FAILED".equals(failure.path("code").asText())) {
                            throw new ModelFailureException();
                        }
                    }
                    throw unavailable();
                }
                JsonNode result = mapper.readTree(bytes);
                if (result == null) throw unavailable();
                return result.has("data") ? result.path("data") : result;
            }
        } catch (IOException | IllegalStateException e) {
            throw unavailable();
        }
    }

    private String resolveEndpoint(String userCode) {
        if (endpointOverride == null || endpointOverride.isBlank()) {
            return endpoints.resolveRequiredEndpoint(userCode, instance);
        }
        try {
            var endpoint = java.net.URI.create(endpointOverride);
            if (!("http".equalsIgnoreCase(endpoint.getScheme()) || "https".equalsIgnoreCase(endpoint.getScheme()))
                || endpoint.getHost() == null || endpoint.getUserInfo() != null
                || endpoint.getQuery() != null || endpoint.getFragment() != null) throw unavailable();
            return endpointOverride;
        } catch (IllegalArgumentException e) {
            throw unavailable();
        }
    }

    private ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY,
            "Speech service is unavailable; check the selected model and Harness media plugin");
    }

    /** Only confirmed model/provider failures may disable a saved model after debugging. */
    public static final class ModelFailureException extends ResponseStatusException {
        public ModelFailureException() {
            super(HttpStatus.BAD_GATEWAY,
                "Speech service is unavailable; check the selected model and Harness media plugin");
        }
    }
}
