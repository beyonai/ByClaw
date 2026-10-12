package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class JdkDeepSeekWebSearchClient implements DeepSeekWebSearchClient {
    static final String DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic/v1";
    static final String DEFAULT_MODEL = "deepseek-v4-flash";
    static final String DEFAULT_API_VERSION = "2023-06-01";
    static final int DEFAULT_MAX_TOKENS = 4096;
    static final int DEFAULT_MAX_USES = 5;
    static final int DEFAULT_TIMEOUT_SECONDS = 120;

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final DeepSeekWebSearchResponseParser parser;

    @Autowired
    public JdkDeepSeekWebSearchClient(ObjectMapper objectMapper) {
        this(HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER)
            .connectTimeout(Duration.ofSeconds(10))
            .build(), objectMapper);
    }

    JdkDeepSeekWebSearchClient(HttpClient httpClient, ObjectMapper objectMapper) {
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
        this.parser = new DeepSeekWebSearchResponseParser(objectMapper);
    }

    @Override
    public DeepSeekWebSearchResult search(ConnectorInfo connector, String apiKey, String query, int maxResults) {
        if (apiKey == null || apiKey.isBlank() || query == null || query.isBlank()) {
            throw new IllegalArgumentException("DeepSeek API key and query are required");
        }
        Settings settings = settings(connector == null ? null : connector.getRequestConfig());
        URI endpoint = trustedEndpoint(settings.baseUrl());
        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", settings.model());
        body.put("max_tokens", settings.maxTokens());
        ArrayNode messages = body.putArray("messages");
        ObjectNode message = messages.addObject().put("role", "user");
        message.putArray("content").addObject()
            .put("type", "text")
            .put("text", "Perform a web search for the query: " + query.trim());
        body.putArray("tools").addObject()
            .put("type", "web_search_20250305")
            .put("name", "web_search")
            .put("max_uses", settings.maxUses());
        HttpRequest request = HttpRequest.newBuilder(endpoint)
            .timeout(Duration.ofSeconds(settings.timeoutSeconds()))
            .header("x-api-key", apiKey)
            .header("Authorization", "Bearer " + apiKey)
            .header("anthropic-version", settings.apiVersion())
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
            .build();
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw httpFailure(response.statusCode());
            }
            return parser.parse(response.body(), maxResults);
        } catch (DeepSeekWebSearchException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new DeepSeekWebSearchException("DEEPSEEK_WEB_SEARCH_INTERRUPTED", "search was interrupted", e);
        } catch (Exception e) {
            throw new DeepSeekWebSearchException("DEEPSEEK_WEB_SEARCH_UNAVAILABLE", "provider request failed", e);
        }
    }

    private URI trustedEndpoint(String baseUrl) {
        URI base = URI.create(baseUrl.replaceAll("/+$", ""));
        if (!"https".equalsIgnoreCase(base.getScheme())
                || !"api.deepseek.com".equalsIgnoreCase(base.getHost())
                || base.getUserInfo() != null || base.getPort() != -1) {
            throw new DeepSeekWebSearchException(
                "DEEPSEEK_WEB_SEARCH_ENDPOINT_NOT_ALLOWED", "only the official DeepSeek HTTPS endpoint is allowed");
        }
        return URI.create(base + "/messages");
    }

    private DeepSeekWebSearchException httpFailure(int status) {
        String code = switch (status) {
            case 401, 403 -> "CONNECTOR_CREDENTIAL_INVALID";
            case 429 -> "DEEPSEEK_WEB_SEARCH_RATE_LIMITED";
            default -> status >= 500
                ? "DEEPSEEK_WEB_SEARCH_UNAVAILABLE"
                : "DEEPSEEK_WEB_SEARCH_PROVIDER_ERROR";
        };
        return new DeepSeekWebSearchException(code, "DeepSeek returned HTTP " + status);
    }

    private Settings settings(String requestConfig) {
        JsonNode config;
        try {
            config = requestConfig == null || requestConfig.isBlank()
                ? objectMapper.createObjectNode()
                : objectMapper.readTree(requestConfig);
        } catch (Exception e) {
            throw new DeepSeekWebSearchException(
                "DEEPSEEK_WEB_SEARCH_CONFIG_INVALID", "request_config is not valid JSON", e);
        }
        return new Settings(
            text(config, "baseUrl", DEFAULT_BASE_URL),
            text(config, "model", DEFAULT_MODEL),
            text(config, "apiVersion", DEFAULT_API_VERSION),
            boundedInt(config, "maxTokens", DEFAULT_MAX_TOKENS, 1, 32768),
            boundedInt(config, "maxUses", DEFAULT_MAX_USES, 1, 20),
            boundedInt(config, "timeoutSeconds", DEFAULT_TIMEOUT_SECONDS, 1, 120));
    }

    private String text(JsonNode config, String key, String fallback) {
        String value = config.path(key).asText("").trim();
        return value.isEmpty() ? fallback : value;
    }

    private int boundedInt(JsonNode config, String key, int fallback, int minimum, int maximum) {
        int value = config.path(key).canConvertToInt() ? config.path(key).intValue() : fallback;
        if (value < minimum || value > maximum) {
            throw new DeepSeekWebSearchException(
                "DEEPSEEK_WEB_SEARCH_CONFIG_INVALID", key + " is outside the allowed range");
        }
        return value;
    }

    private record Settings(
        String baseUrl, String model, String apiVersion, int maxTokens, int maxUses, int timeoutSeconds) {
    }
}
