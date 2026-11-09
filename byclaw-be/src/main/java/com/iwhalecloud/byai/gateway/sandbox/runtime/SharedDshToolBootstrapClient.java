package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.service.ToolEnvironmentBootstrapKeys;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Obtains request-scoped bootstrap material from the user's persistent shared DSH identity. */
@Component
public class SharedDshToolBootstrapClient {
    private static final String FAILURE = "Unable to obtain shared DSH tool environment bootstrap";
    private static final int MAX_RESPONSE_BYTES = 32 * 1024;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private final Call.Factory httpClient;
    private final ObjectMapper mapper = new ObjectMapper()
        .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    public SharedDshToolBootstrapClient() {
        this(new OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(Duration.ofSeconds(5))
            .readTimeout(Duration.ofSeconds(10))
            .writeTimeout(Duration.ofSeconds(10))
            .callTimeout(Duration.ofSeconds(15))
            .build());
    }

    SharedDshToolBootstrapClient(Call.Factory httpClient) {
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient");
    }

    public Map<String, String> load(SandboxLaunchData context, String serviceKey) {
        try {
            if (context == null || serviceKey == null || serviceKey.isBlank() || serviceKey.length() > 256) {
                throw unavailable();
            }
            HttpUrl endpoint = userEndpoint(context);
            String token = webToken(context, endpoint);
            HttpUrl url = endpoint.newBuilder().query(null).fragment(null)
                .removePathSegment(endpoint.pathSize() - 1)
                .addPathSegments("api/byclaw/tool-environment/bootstrap").build();
            Request.Builder request = new Request.Builder().url(url);
            if (context.getEndpointHeaders() != null) {
                context.getEndpointHeaders().forEach(request::header);
            }
            request.header("Cookie", "byclaw_web_token=" + token)
                .header("Accept", "application/json")
                .post(RequestBody.create(mapper.writeValueAsString(Map.of("serviceKey", serviceKey)), JSON));
            try (Response response = httpClient.newCall(request.build()).execute()) {
                ResponseBody body = response.body();
                if (response.code() != 200 || body == null || body.contentLength() > MAX_RESPONSE_BYTES) {
                    throw unavailable();
                }
                byte[] bytes = body.byteStream().readNBytes(MAX_RESPONSE_BYTES + 1);
                if (bytes.length > MAX_RESPONSE_BYTES) throw unavailable();
                Map<String, Object> payload = mapper.readValue(bytes, new TypeReference<>() { });
                if (payload == null || !serviceKey.equals(payload.get("serviceKey"))) throw unavailable();
                Map<String, String> keys = ToolEnvironmentBootstrapKeys.parse(payload.get("toolEnvironmentKeys"));
                if (keys.isEmpty()) throw unavailable();
                return keys;
            }
        } catch (IOException | RuntimeException failure) {
            // Neither endpoint URLs, authentication cookies, response keys nor transport causes may escape.
            throw unavailable();
        }
    }

    private HttpUrl userEndpoint(SandboxLaunchData context) {
        String endpoint = context.getEndpoint();
        if (endpoint == null || endpoint.isBlank()) {
            List<String> endpoints = context.getEndpoints();
            endpoint = endpoints == null || endpoints.isEmpty() ? null : endpoints.getFirst();
        }
        if (endpoint == null || endpoint.isBlank()) throw unavailable();
        URI uri = URI.create(endpoint);
        HttpUrl url = HttpUrl.parse(endpoint);
        if (url == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                || !url.encodedPath().equals(uri.getRawPath())) throw unavailable();
        List<String> path = url.pathSegments();
        int size = path.size();
        if (size < 3 || !("chat".equals(path.getLast()) || path.getLast().isEmpty())
                || !"u".equals(path.get(size - 3))
                || path.get(size - 2).isBlank()
                || path.stream().anyMatch(segment -> segment.contains("/") || segment.contains("\\")
                    || segment.chars().anyMatch(character -> character < 32 || character == 127))) {
            throw unavailable();
        }
        return url;
    }

    private String webToken(SandboxLaunchData context, HttpUrl endpoint) {
        List<String> queryTokens = endpoint.queryParameterValues("token");
        if (queryTokens.size() > 1) throw unavailable();
        String gatewayToken = context.getGatewayToken();
        String queryToken = queryTokens.isEmpty() ? null : queryTokens.getFirst();
        if (!queryTokens.isEmpty() && (queryToken == null || queryToken.isBlank())) throw unavailable();
        if (gatewayToken != null && queryToken != null && !gatewayToken.equals(queryToken)) throw unavailable();
        String token = gatewayToken != null ? gatewayToken : queryToken;
        if (token == null || !token.matches("[A-Za-z0-9._~-]{1,4096}")) throw unavailable();
        return token;
    }

    private IllegalStateException unavailable() {
        return new IllegalStateException(FAILURE);
    }
}
