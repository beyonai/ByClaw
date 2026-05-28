package com.iwhalecloud.byai.gateway.sandbox.client;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignApiError;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignApiErrorResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignConversationResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignConversationsResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignCreateProjectResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignHealthResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignMessageResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignProjectResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignRunCreateResponse;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignRequestEnvironment;
import com.iwhalecloud.byai.gateway.sandbox.service.exception.OpenDesignAdapterException;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Open Design daemon HTTP 客户端。
 * 这里只封装接口调用、响应反序列化和错误翻译，不处理跳转编排规则。
 */
public class OpenDesignClient {

    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");
    private static final ObjectMapper OBJECT_MAPPER = createObjectMapper();

    private final OkHttpClient httpClient;

    public OpenDesignClient() {
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(Duration.ofSeconds(30))
            .readTimeout(Duration.ofSeconds(60))
            .writeTimeout(Duration.ofSeconds(60))
            .build();
    }

    /**
     * 健康检查用于提前探测 daemon 是否可用。
     * 一旦这里失败，外层会直接返回错误而不是继续创建项目或 run。
     */
    public OpenDesignHealthResponse getHealth(OpenDesignRequestEnvironment env) {
        return request(env, "/api/health", "GET", null, OpenDesignHealthResponse.class);
    }

    public OpenDesignProjectResponse getProject(OpenDesignRequestEnvironment env, String projectId) {
        return requestOrNull(env, "/api/projects/" + projectId, "GET", null, OpenDesignProjectResponse.class);
    }

    public OpenDesignCreateProjectResponse createProject(OpenDesignRequestEnvironment env, Map<String, Object> body) {
        return request(env, "/api/projects", "POST", body, OpenDesignCreateProjectResponse.class);
    }

    public OpenDesignConversationsResponse listConversations(OpenDesignRequestEnvironment env, String projectId) {
        return request(env, "/api/projects/" + projectId + "/conversations", "GET", null,
            OpenDesignConversationsResponse.class);
    }

    public OpenDesignConversationResponse createConversation(OpenDesignRequestEnvironment env, String projectId,
        Map<String, Object> body) {
        return request(env, "/api/projects/" + projectId + "/conversations", "POST", body,
            OpenDesignConversationResponse.class);
    }

    public OpenDesignConversationResponse updateConversation(OpenDesignRequestEnvironment env, String projectId,
        String conversationId,
        Map<String, Object> body) {
        return request(env, "/api/projects/" + projectId + "/conversations/" + conversationId, "PATCH", body,
            OpenDesignConversationResponse.class);
    }

    public OpenDesignMessageResponse putMessage(OpenDesignRequestEnvironment env, String projectId, String conversationId,
        String messageId, Map<String, Object> body) {
        return request(env,
            "/api/projects/" + projectId + "/conversations/" + conversationId + "/messages/" + messageId,
            "PUT", body, OpenDesignMessageResponse.class);
    }

    public OpenDesignRunCreateResponse createRun(OpenDesignRequestEnvironment env, Map<String, Object> body) {
        return request(env, "/api/runs", "POST", body, OpenDesignRunCreateResponse.class);
    }

    private <T> T request(OpenDesignRequestEnvironment env, String path, String method, Map<String, Object> body,
        Class<T> responseType) {
        return requestInternal(env, path, method, body, responseType, false);
    }

    private <T> T requestOrNull(OpenDesignRequestEnvironment env, String path, String method,
        Map<String, Object> body, Class<T> responseType) {
        return requestInternal(env, path, method, body, responseType, true);
    }

    private <T> T requestInternal(OpenDesignRequestEnvironment env, String path, String method,
        Map<String, Object> body, Class<T> responseType, boolean allowNotFound) {
        try (Response response = execute(env, path, method, body)) {
            if (allowNotFound && response.code() == 404) {
                // 项目不存在是编排层的正常分支，不在 client 里直接抛错。
                return null;
            }
            String responseBody = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                throw new OpenDesignAdapterException(502,
                    "Open Design API " + path + " failed: " + extractErrorMessage(responseBody, response.code()));
            }
            if (responseType == null || StringUtils.isBlank(responseBody)) {
                return null;
            }
            return OBJECT_MAPPER.readValue(responseBody, responseType);
        }
        catch (OpenDesignAdapterException e) {
            throw e;
        }
        catch (Exception e) {
            throw new OpenDesignAdapterException(502, "Failed to call Open Design API: " + path, e);
        }
    }

    private Response execute(OpenDesignRequestEnvironment env, String path, String method, Map<String, Object> body)
        throws Exception {
        Request.Builder builder = new Request.Builder()
            .url(env.getDaemonBaseUrl() + path)
            .header("Accept", "application/json");
        if (env.getHeaders() != null) {
            for (Map.Entry<String, String> entry : env.getHeaders().entrySet()) {
                if (StringUtils.isNotBlank(entry.getKey()) && StringUtils.isNotBlank(entry.getValue())) {
                    builder.header(entry.getKey(), entry.getValue());
                }
            }
        }
        if (body != null) {
            builder.header("Content-Type", "application/json");
            builder.method(method, RequestBody.create(toJson(body), JSON_MEDIA_TYPE));
        }
        else {
            // 某些服务端实现会要求显式空 body，这里统一兜底，避免 PATCH/POST 因 null body 被拒绝。
            builder.method(method, requiresBody(method) ? RequestBody.create(new byte[0], null) : null);
        }
        return httpClient.newCall(builder.build()).execute();
    }

    private boolean requiresBody(String method) {
        return "POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method) || "PATCH".equalsIgnoreCase(method);
    }

    private String extractErrorMessage(String rawBody, int statusCode) {
        OpenDesignApiErrorResponse errorResponse = parseErrorResponse(rawBody);
        OpenDesignApiError error = errorResponse != null ? errorResponse.getError() : null;
        if (error != null && StringUtils.isNotBlank(error.getMessage())) {
            // daemon 的标准错误体是 { error: { code, message } }，优先提取 message。
            return error.getMessage();
        }
        if (StringUtils.isNotBlank(rawBody)) {
            return rawBody;
        }
        return "HTTP " + statusCode;
    }

    private OpenDesignApiErrorResponse parseErrorResponse(String responseBody) {
        if (StringUtils.isBlank(responseBody)) {
            return null;
        }
        try {
            return OBJECT_MAPPER.readValue(responseBody, OpenDesignApiErrorResponse.class);
        }
        catch (Exception ignored) {
            return null;
        }
    }

    private String toJson(Map<String, Object> body) {
        try {
            // 请求体里统一去掉 null 字段，避免把“未指定”和“显式置空”混在一起发给 daemon。
            return OBJECT_MAPPER.writeValueAsString(removeNullValues(body));
        }
        catch (Exception e) {
            throw new OpenDesignAdapterException(500, "Failed to serialize Open Design request body", e);
        }
    }

    private Map<String, Object> removeNullValues(Map<String, Object> source) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : source.entrySet()) {
            if (entry.getValue() != null) {
                result.put(entry.getKey(), entry.getValue());
            }
        }
        return result;
    }

    private static ObjectMapper createObjectMapper() {
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        return objectMapper;
    }
}
