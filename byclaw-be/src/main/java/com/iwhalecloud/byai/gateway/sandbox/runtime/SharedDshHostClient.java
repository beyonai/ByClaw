package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Admin API client of the shared DSH host ({@code /v1/users/{userCode}}, bearer token).
 */
public class SharedDshHostClient {

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final Call.Factory httpClient;
    private final HttpUrl baseUrl;
    private final String token;
    private final ObjectMapper objectMapper;

    public SharedDshHostClient(SandboxProperties.SharedDshHostConfig config) {
        this(new OkHttpClient.Builder()
                .connectTimeout(config.getConnectTimeout())
                .readTimeout(config.getRequestTimeout())
                .callTimeout(config.getRequestTimeout())
                .build(),
            config.getBaseUrl(), config.getToken());
    }

    SharedDshHostClient(Call.Factory httpClient, String baseUrl, String token) {
        if (StringUtils.isBlank(token)) {
            throw new IllegalStateException("byclaw.sandbox.shared-dsh-host.token is required when base-url is set");
        }
        HttpUrl parsed = HttpUrl.parse(StringUtils.trimToEmpty(baseUrl));
        if (parsed == null) {
            throw new IllegalStateException("Invalid byclaw.sandbox.shared-dsh-host.base-url: " + baseUrl);
        }
        this.httpClient = httpClient;
        this.baseUrl = parsed;
        this.token = token.trim();
        this.objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    /** {@code PUT /v1/users/{userCode}}: ensures the user's context runs. Throws unless the host answers ready. */
    public UserContext ensureUser(String userCode, String sandboxId, Map<String, String> env) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("sandboxId", sandboxId);
        if (env != null && !env.isEmpty()) {
            body.put("env", env);
        }
        Request request = authorized(userUrl(userCode)).put(RequestBody.create(toJson(body), JSON)).build();
        UserContext context = execute(request, userCode, false);
        if (context == null || !UserContext.STATUS_READY.equals(context.getStatus())) {
            throw new IllegalStateException("Shared DSH host did not start user " + userCode + ": "
                + (context != null ? StringUtils.defaultIfBlank(context.getError(), context.getStatus()) : "empty response"));
        }
        if (StringUtils.isBlank(context.getWebToken())) {
            throw new IllegalStateException("Shared DSH host returned no webToken for user " + userCode);
        }
        return context;
    }

    /** {@code GET /v1/users/{userCode}}; 404 counts as absent. */
    public UserContext getUser(String userCode) {
        UserContext context = execute(authorized(userUrl(userCode)).get().build(), userCode, true);
        return context != null ? context : UserContext.absent();
    }

    /** {@code DELETE /v1/users/{userCode}}; idempotent, 404 counts as success. */
    public void deleteUser(String userCode) {
        execute(authorized(userUrl(userCode)).delete().build(), userCode, true);
    }

    private UserContext execute(Request request, String userCode, boolean notFoundIsSuccess) {
        try (Response response = httpClient.newCall(request).execute()) {
            ResponseBody responseBody = response.body();
            String text = responseBody != null ? responseBody.string() : "";
            if (response.isSuccessful() || (notFoundIsSuccess && response.code() == 404)) {
                return StringUtils.isBlank(text) ? null : objectMapper.readValue(text, UserContext.class);
            }
            String error = text;
            try {
                UserContext failed = objectMapper.readValue(text, UserContext.class);
                error = StringUtils.defaultIfBlank(failed.getError(), text);
            }
            catch (IOException ignored) {
                // Non-JSON error body: report it verbatim.
            }
            throw new IllegalStateException("Shared DSH host " + request.method() + " user " + userCode
                + " failed: HTTP " + response.code() + " " + StringUtils.abbreviate(error, 300));
        }
        catch (IOException e) {
            throw new IllegalStateException("Shared DSH host " + request.method() + " user " + userCode
                + " failed: " + e.getMessage(), e);
        }
    }

    private Request.Builder authorized(HttpUrl url) {
        return new Request.Builder().url(url).header("Authorization", "Bearer " + token);
    }

    private HttpUrl userUrl(String userCode) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException("userCode is required");
        }
        return baseUrl.newBuilder().addPathSegment("v1").addPathSegment("users").addPathSegment(userCode).build();
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        }
        catch (IOException e) {
            throw new IllegalStateException("Failed to serialize shared DSH host request", e);
        }
    }

    /** Response of PUT and GET; PUT fills the web fields, GET the activity fields. */
    @lombok.Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class UserContext {
        public static final String STATUS_ABSENT = "absent";
        public static final String STATUS_STARTING = "starting";
        public static final String STATUS_READY = "ready";
        public static final String STATUS_FAILED = "failed";

        private String userCode;
        private String status;
        private String hostId;
        private String webPath;
        private String webToken;
        private Boolean busy;
        private Long lastActiveAt;
        private String error;

        static UserContext absent() {
            UserContext context = new UserContext();
            context.setStatus(STATUS_ABSENT);
            return context;
        }
    }
}
