package com.iwhalecloud.byai.state.application.service.recorder;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class BycliRecorderSavePort implements RecorderSavePort {

    static final int MAX_RESPONSE_BYTES = 1024 * 1024;

    private static final String BYCLI_HEADER = "X-byCLI";
    private static final String SAVE_PATH = "/v1/save-adapter";
    private static final Path BYCLI_ROOT = Path.of("/by/.bycli");
    private static final Set<String> DAEMON_ERROR_CODES = Set.of(
        "validation_failed", "auth_failed", "unauthorized", "forbidden",
        "daemon_timeout", "daemon_unavailable", "internal_error"
    );
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final SandboxIngressEndpointResolver endpointResolver;
    private final RecorderSandboxEndpointResolver recorderEndpointResolver;
    private final RecorderSaveProperties properties;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    @Autowired
    public BycliRecorderSavePort(
        RecorderSandboxEndpointResolver endpointResolver,
        RecorderSaveProperties properties
    ) {
        this(
            endpointResolver,
            properties,
            HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(Math.max(1, properties.getTimeoutMs())))
                .build(),
            new ObjectMapper()
        );
    }

    BycliRecorderSavePort(
        SandboxIngressEndpointResolver endpointResolver,
        RecorderSaveProperties properties,
        HttpClient httpClient,
        ObjectMapper objectMapper
    ) {
        this.endpointResolver = endpointResolver;
        this.recorderEndpointResolver = null;
        this.properties = properties;
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
    }

    BycliRecorderSavePort(
        RecorderSandboxEndpointResolver endpointResolver,
        RecorderSaveProperties properties,
        HttpClient httpClient,
        ObjectMapper objectMapper
    ) {
        this.endpointResolver = null;
        this.recorderEndpointResolver = endpointResolver;
        this.properties = properties;
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
    }

    @Override
    public PublishResult publish(RecorderOwner owner, String name, String source, String llmModel, boolean overwrite) {
        if (!properties.isProductionEnabled()) {
            throw new RecorderSaveException(
                "save_adapter_disabled",
                "production adapter publishing is disabled"
            );
        }
        if (name == null || name.isBlank() || source == null || source.isBlank()) {
            throw new RecorderSaveException("validation_failed", "adapter publish validation failed");
        }

        URI uri = resolveSaveUri(owner);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        body.put("source", source);
        body.put("overwrite", overwrite);
        if (llmModel != null) {
            body.put("llmModel", llmModel);
        }

        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofMillis(requireTimeout()))
                .header(BYCLI_HEADER, "1")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build();
        } catch (JsonProcessingException e) {
            throw protocolError(e);
        }

        DaemonResponse response = send(request);
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            if (response.statusCode() == 409) {
                throw adapterExists(response.body());
            }
            requireErrorEnvelope(response.body(), response.statusCode());
            throw httpError(response.statusCode());
        }
        Map<String, Object> data = envelopeData(response.body());
        String adapterPath = validatedBycliPath(data.get("adapterPath"));
        String reportPath = validatedBycliPath(data.get("reportPath"));
        return new PublishResult(adapterPath, reportPath);
    }

    private URI resolveSaveUri(RecorderOwner owner) {
        if (recorderEndpointResolver != null) {
            return recorderEndpointResolver.resolve(owner, properties.getInstance(), SAVE_PATH);
        }
        String endpoint;
        try {
            if (owner == null || owner.userCode() == null || owner.userCode().isBlank()) {
                throw new IllegalStateException("missing recorder owner");
            }
            endpoint = endpointResolver.resolveRequiredEndpoint(owner.userCode(), properties.getInstance());
            URI base = URI.create(endpoint);
            String scheme = base.getScheme();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                || base.getHost() == null
                || base.getUserInfo() != null
                || base.getPort() == 0
                || base.getPort() > 65_535
                || base.getQuery() != null
                || base.getFragment() != null
                || !(base.getPath().isEmpty() || "/".equals(base.getPath()))) {
                throw new IllegalArgumentException("invalid sandbox endpoint");
            }
            return base.resolve(SAVE_PATH);
        } catch (RuntimeException e) {
            throw unavailable(e);
        }
    }

    private int requireTimeout() {
        int timeoutMs = properties.getTimeoutMs();
        if (timeoutMs <= 0) {
            throw unavailable(null);
        }
        return timeoutMs;
    }

    private DaemonResponse send(HttpRequest request) {
        CompletableFuture<HttpResponse<byte[]>> future;
        try {
            future = httpClient.sendAsync(request, limitedBodyHandler(MAX_RESPONSE_BYTES));
        } catch (IllegalArgumentException e) {
            throw unavailable(e);
        }
        try {
            HttpResponse<byte[]> response = future.get(requireTimeout(), TimeUnit.MILLISECONDS);
            byte[] responseBody = response.body();
            Map<String, Object> payload = responseBody.length == 0
                ? Map.of()
                : objectMapper.readValue(responseBody, MAP_TYPE);
            return new DaemonResponse(response.statusCode(), payload);
        } catch (JsonProcessingException e) {
            throw protocolError(e);
        } catch (IOException e) {
            throw protocolError(e);
        } catch (TimeoutException e) {
            future.cancel(true);
            throw timeout(e);
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw unavailable(e);
        } catch (ExecutionException e) {
            Throwable cause = unwrap(e.getCause());
            if (cause instanceof ResponseTooLargeException) {
                throw protocolError(cause);
            }
            if (cause instanceof HttpTimeoutException) {
                throw timeout(cause);
            }
            if (cause instanceof IOException || cause instanceof IllegalArgumentException) {
                throw unavailable(cause);
            }
            throw unavailable(cause);
        }
    }

    private HttpResponse.BodyHandler<byte[]> limitedBodyHandler(int maxBytes) {
        return responseInfo -> new LimitedBodySubscriber(
            HttpResponse.BodySubscribers.ofByteArray(),
            maxBytes
        );
    }

    private RecorderSaveException httpError(int statusCode) {
        if (statusCode == 400) {
            return new RecorderSaveException("validation_failed", "adapter publish validation failed");
        }
        if (statusCode == 408 || statusCode == 504) {
            return new RecorderSaveException("daemon_timeout", "user byCLI daemon timed out");
        }
        return unavailable(null);
    }

    private RecorderSaveException adapterExists(Map<String, Object> payload) {
        if (!Boolean.FALSE.equals(payload.get("ok"))
            || !"adapter_exists".equals(stringValue(payload.get("errorCode")))
            || !(payload.get("error") instanceof String error)
            || error.isBlank()
            || !(payload.get("data") instanceof Map<?, ?> rawData)) {
            throw protocolError(null);
        }
        Object rawPath = rawData.get("adapterPath");
        String adapterPath = validatedBycliPath(rawPath);
        return new RecorderSaveException(
            "adapter_exists",
            "CLI adapter already exists",
            Map.of("adapterPath", adapterPath)
        );
    }

    private Map<String, Object> envelopeData(Map<String, Object> payload) {
        if (!Boolean.TRUE.equals(payload.get("ok")) || !(payload.get("data") instanceof Map<?, ?> raw)) {
            throw protocolError(null);
        }
        Map<String, Object> data = new LinkedHashMap<>();
        raw.forEach((key, value) -> {
            if (key instanceof String text) {
                data.put(text, value);
            }
        });
        return data;
    }

    private void requireErrorEnvelope(Map<String, Object> payload, int statusCode) {
        if (!Boolean.FALSE.equals(payload.get("ok"))
            || (payload.containsKey("data") && payload.get("data") != null)) {
            throw protocolError(null);
        }
        String code = stringValue(payload.get("errorCode"));
        Object error = payload.get("error");
        boolean hasError = error instanceof String text && !text.isBlank();
        if (error instanceof Map<?, ?> errorMap) {
            String nestedCode = stringValue(errorMap.get("code"));
            if (nestedCode != null) {
                code = nestedCode;
                hasError = true;
            }
        }
        if (!hasError) {
            throw protocolError(null);
        }
        if (code == null && (statusCode == 401 || statusCode == 403)) {
            return;
        }
        if (code == null || !DAEMON_ERROR_CODES.contains(code)) {
            throw protocolError(null);
        }
        if (statusCode == 400 && !"validation_failed".equals(code)) {
            throw protocolError(null);
        }
    }

    private String validatedBycliPath(Object value) {
        if (!(value instanceof String text) || text.isBlank() || hasUnsafeCharacter(text) || hasTraversalSegment(text)) {
            throw protocolError(null);
        }
        try {
            Path raw = Path.of(text);
            Path normalized = raw.normalize();
            if (!raw.isAbsolute()
                || !raw.equals(normalized)
                || normalized.equals(BYCLI_ROOT)
                || !normalized.startsWith(BYCLI_ROOT)) {
                throw protocolError(null);
            }
            return normalized.toString();
        } catch (InvalidPathException e) {
            throw protocolError(e);
        }
    }

    private boolean hasUnsafeCharacter(String value) {
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (character == '\\' || Character.isISOControl(character)) {
                return true;
            }
        }
        return false;
    }

    private boolean hasTraversalSegment(String value) {
        for (String segment : value.split("/", -1)) {
            if (".".equals(segment) || "..".equals(segment)) {
                return true;
            }
        }
        return false;
    }

    private RecorderSaveException protocolError(Throwable cause) {
        return new RecorderSaveException(
            "daemon_protocol_error",
            "byCLI daemon returned malformed publish data",
            cause
        );
    }

    private RecorderSaveException timeout(Throwable cause) {
        return new RecorderSaveException("daemon_timeout", "user byCLI daemon timed out", cause);
    }

    private RecorderSaveException unavailable(Throwable cause) {
        return new RecorderSaveException(
            "daemon_unavailable",
            "user byCLI daemon is unavailable",
            cause
        );
    }

    private String stringValue(Object value) {
        return value instanceof String text && !text.isBlank() ? text : null;
    }

    private Throwable unwrap(Throwable cause) {
        Throwable current = cause;
        while (current instanceof CompletionException && current.getCause() != null) {
            current = current.getCause();
        }
        return current;
    }

    private record DaemonResponse(int statusCode, Map<String, Object> body) {
    }

    private static final class LimitedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {

        private final HttpResponse.BodySubscriber<byte[]> delegate;
        private final int maxBytes;
        private long receivedBytes;
        private Flow.Subscription subscription;
        private boolean terminated;

        private LimitedBodySubscriber(HttpResponse.BodySubscriber<byte[]> delegate, int maxBytes) {
            this.delegate = delegate;
            this.maxBytes = maxBytes;
        }

        @Override
        public CompletionStage<byte[]> getBody() {
            return delegate.getBody();
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            delegate.onSubscribe(subscription);
        }

        @Override
        public void onNext(List<ByteBuffer> item) {
            if (terminated) {
                return;
            }
            long nextBytes = receivedBytes;
            for (ByteBuffer buffer : item) {
                nextBytes += buffer.remaining();
                if (nextBytes > maxBytes) {
                    terminated = true;
                    subscription.cancel();
                    delegate.onError(new ResponseTooLargeException());
                    return;
                }
            }
            receivedBytes = nextBytes;
            delegate.onNext(item);
        }

        @Override
        public void onError(Throwable throwable) {
            if (!terminated) {
                terminated = true;
                delegate.onError(throwable);
            }
        }

        @Override
        public void onComplete() {
            if (!terminated) {
                terminated = true;
                delegate.onComplete();
            }
        }
    }

    private static final class ResponseTooLargeException extends RuntimeException {
    }
}
