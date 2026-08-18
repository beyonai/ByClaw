package com.iwhalecloud.byai.manager.application.service.aimodel;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import java.io.IOException;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import lombok.extern.slf4j.Slf4j;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * MiniMax image-generation model debugging service.
 */
@Service
@Slf4j
public class ModelDebugImageGenerationApplicationService {

    private static final String PROVIDER_MINIMAX = "MINIMAX";

    private static final String PROTOCOL_MINIMAX_IMAGE = "MINIMAX_IMAGE";

    private static final String IMAGE_GENERATION_PATH = "/v1/image_generation";

    private static final String RESPONSE_FORMAT_URL = "url";

    private static final String RESPONSE_FORMAT_BASE64 = "base64";

    private static final long DEFAULT_CONNECT_TIMEOUT_MS = 30_000L;

    private static final long DEFAULT_READ_TIMEOUT_MS = 120_000L;

    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");

    private final ObjectMapper objectMapper;

    @Value("${byai.gptproxy.connectTimeoutMs:30000}")
    private long connectTimeoutMs;

    @Value("${byai.gptproxy.readTimeoutMs:120000}")
    private long readTimeoutMs;

    public ModelDebugImageGenerationApplicationService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * Calls the configured MiniMax image generation endpoint and returns its parsed JSON body.
     *
     * @param body debug request containing a JSON string or object in {@code input}
     * @return sanitized upstream JSON body; HTTP response headers are never exposed
     */
    public JsonNode startImageGenerationDebug(Map<String, Object> body) {
        JsonNode input = parseInput(body == null ? null : body.get("input"));
        validateProvider(input);
        String url = validateUrl(textValue(input, "url"));
        String authorization = bearerAuthorization(input.path("headers"));
        JsonNode param = input.path("param");
        if (!param.isObject()) {
            throw invalidInput();
        }
        String responseFormat = textValue(param, "response_format");
        if (responseFormat == null || responseFormat.isBlank()) {
            responseFormat = RESPONSE_FORMAT_URL;
        }
        if (!RESPONSE_FORMAT_URL.equals(responseFormat) && !RESPONSE_FORMAT_BASE64.equals(responseFormat)) {
            throw invalidInput();
        }

        Request request = new Request.Builder().url(url).post(RequestBody.create(writeJson(param), JSON_MEDIA_TYPE))
            .header("Accept", "application/json").header("Content-Type", "application/json")
            .header("Authorization", authorization).build();
        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(positiveTimeout(connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS), TimeUnit.MILLISECONDS)
            .readTimeout(positiveTimeout(readTimeoutMs, DEFAULT_READ_TIMEOUT_MS), TimeUnit.MILLISECONDS).build();

        try (Response response = client.newCall(request).execute()) {
            ResponseBody bodyContent = response.body();
            String responseJson = bodyContent == null ? "" : bodyContent.string();
            if (!response.isSuccessful()) {
                throw upstreamFailure(response.code());
            }
            JsonNode parsed = objectMapper.readTree(responseJson);
            validateResponse(parsed, responseFormat);
            return parsed;
        }
        catch (BaseException e) {
            throw e;
        }
        catch (IOException | RuntimeException e) {
            log.warn("MiniMax image debug request failed, host={}, cause={}", safeHost(url),
                e.getClass().getSimpleName());
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_50010, "aimodel.debug.upstream.error");
        }
    }

    private JsonNode parseInput(Object rawInput) {
        if (rawInput instanceof Map<?, ?> inputMap) {
            return objectMapper.valueToTree(inputMap);
        }
        if (!(rawInput instanceof String inputJson) || inputJson.isBlank()) {
            throw invalidInput();
        }
        try {
            JsonNode input = objectMapper.readTree(inputJson);
            if (input == null || !input.isObject()) {
                throw invalidInput();
            }
            return input;
        }
        catch (JsonProcessingException e) {
            throw invalidInput();
        }
    }

    private void validateProvider(JsonNode input) {
        if (!PROVIDER_MINIMAX.equals(textValue(input, "providerName"))
            || !PROTOCOL_MINIMAX_IMAGE.equals(textValue(input, "modelProtocol"))) {
            throw invalidInput();
        }
    }

    private String validateUrl(String url) {
        try {
            HttpUrl httpUrl = HttpUrl.get(url == null ? "" : url);
            if (!IMAGE_GENERATION_PATH.equals(httpUrl.encodedPath())) {
                throw invalidInput();
            }
            return httpUrl.toString();
        }
        catch (IllegalArgumentException e) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001,
                "aimodel.debug.rerank.url.required");
        }
    }

    private String bearerAuthorization(JsonNode headers) {
        if (!headers.isObject()) {
            throw invalidInput();
        }
        String authorization = null;
        var fields = headers.fields();
        while (fields.hasNext()) {
            var field = fields.next();
            if ("authorization".equalsIgnoreCase(field.getKey()) && field.getValue().isTextual()) {
                authorization = field.getValue().asText();
                break;
            }
        }
        if (authorization == null || !authorization.startsWith("Bearer ")
            || authorization.substring("Bearer ".length()).isBlank()) {
            throw invalidInput();
        }
        return authorization;
    }

    private String writeJson(JsonNode value) {
        try {
            return objectMapper.writeValueAsString(value);
        }
        catch (JsonProcessingException e) {
            throw invalidInput();
        }
    }

    private void validateResponse(JsonNode response, String responseFormat) {
        if (response == null || !response.isObject()
            || response.path("base_resp").path("status_code").asInt(Integer.MIN_VALUE) != 0) {
            throw upstreamFailure(200);
        }
        String imageField = RESPONSE_FORMAT_BASE64.equals(responseFormat) ? "image_base64" : "image_urls";
        JsonNode images = response.path("data").path(imageField);
        if (!images.isArray() || images.isEmpty() || !images.get(0).isTextual() || images.get(0).asText().isBlank()) {
            throw upstreamFailure(200);
        }
    }

    private BaseException invalidInput() {
        return new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.debug.rerank.input.required");
    }

    private BaseException upstreamFailure(int statusCode) {
        int errorCode = statusCode >= 400 && statusCode < 500 ? CommonErrorCode.AIMODEL_ERROR_CODE_40001
            : CommonErrorCode.AIMODEL_ERROR_CODE_50010;
        return new BaseException(errorCode, "aimodel.debug.upstream.error");
    }

    private String textValue(JsonNode node, String fieldName) {
        JsonNode value = node == null ? null : node.get(fieldName);
        return value != null && value.isTextual() ? value.asText() : null;
    }

    private long positiveTimeout(long configured, long fallback) {
        return configured > 0 ? configured : fallback;
    }

    private String safeHost(String url) {
        try {
            return URI.create(url).getHost();
        }
        catch (Exception e) {
            return "unknown";
        }
    }

}
