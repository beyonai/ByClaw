package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class JdkWeixinOpenPlatformClient implements WeixinOpenPlatformClient {
    private static final String BASE = "https://api.weixin.qq.com/cgi-bin/component/";
    private static final Duration TIMEOUT = Duration.ofSeconds(30);
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper()
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    public JdkWeixinOpenPlatformClient() {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build());
    }

    JdkWeixinOpenPlatformClient(HttpClient httpClient) {
        this.httpClient = httpClient;
    }

    @Override
    public String componentToken(String appid, String secret, String ticket) {
        JsonNode root = post("api_component_token", null, object(
            "component_appid", appid,
            "component_appsecret", secret,
            "component_verify_ticket", ticket));
        return requiredText(root, "component_access_token");
    }

    @Override
    public String createPreAuthCode(String token, String appid) {
        JsonNode root = post("api_create_preauthcode", token, object("component_appid", appid));
        return requiredText(root, "pre_auth_code");
    }

    @Override
    public AuthorizerToken queryAuthorization(String token, String appid, String code) {
        JsonNode root = post("api_query_auth", token, object(
            "component_appid", appid, "authorization_code", code));
        return parseAuthorizerToken(requiredObject(root, "authorization_info"), true);
    }

    @Override
    public AuthorizerToken refreshAuthorizerToken(
            String token, String appid, String authorizerAppid, String refreshToken) {
        JsonNode root = post("api_authorizer_token", token, object(
            "component_appid", appid,
            "authorizer_appid", authorizerAppid,
            "authorizer_refresh_token", refreshToken));
        return parseAuthorizerToken(root, false, authorizerAppid);
    }

    @Override
    public AuthorizerProfile getAuthorizerInfo(String token, String appid, String authorizerAppid) {
        JsonNode root = post("api_get_authorizer_info", token, object(
            "component_appid", appid,
            "authorizer_appid", authorizerAppid));
        JsonNode authorizerInfo = requiredObject(root, "authorizer_info");
        JsonNode authorizationInfo = root.path("authorization_info");
        if (authorizationInfo.isObject()) {
            String responseAppid = text(authorizationInfo, "authorizer_appid");
            if (!StringUtils.hasText(responseAppid)) {
                responseAppid = text(authorizationInfo, "authorization_appid");
            }
            if (StringUtils.hasText(responseAppid) && !authorizerAppid.equals(responseAppid)) {
                throw failure(false);
            }
        }
        return new AuthorizerProfile(
            authorizerAppid,
            requiredText(authorizerInfo, "nick_name"),
            requiredText(authorizerInfo, "user_name"),
            requiredText(authorizerInfo, "principal_name"));
    }

    private JsonNode post(String path, String token, JsonNode body) {
        String endpoint = BASE + path + (StringUtils.hasText(token)
            ? "?component_access_token=" + java.net.URLEncoder.encode(token, StandardCharsets.UTF_8) : "");
        HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint))
            .timeout(TIMEOUT)
            .header("Content-Type", "application/json; charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
            .build();
        try {
            HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                close(response.body());
                throw failure(false);
            }
            byte[] bytes = readBounded(response.body());
            JsonNode root = objectMapper.readTree(bytes);
            if (root == null || !root.isObject() || root.has("errcode") && root.path("errcode").asInt(-1) != 0) {
                throw failure(false);
            }
            return root;
        } catch (HttpTimeoutException e) {
            throw failure(true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw failure(false);
        } catch (IOException | RuntimeException e) {
            if (e instanceof WeixinOpenPlatformClientException clientException) {
                throw clientException;
            }
            throw failure(false);
        }
    }

    private AuthorizerToken parseAuthorizerToken(JsonNode node, boolean requireAppid) {
        return parseAuthorizerToken(node, requireAppid, null);
    }

    private AuthorizerToken parseAuthorizerToken(JsonNode node, boolean requireAppid, String fallbackAppid) {
        String appid = text(node, "authorizer_appid");
        if (!StringUtils.hasText(appid)) {
            appid = fallbackAppid;
        }
        if (requireAppid && !StringUtils.hasText(appid)) {
            throw failure(false);
        }
        String accessToken = requiredText(node, "authorizer_access_token");
        String refreshToken = requiredText(node, "authorizer_refresh_token");
        long expires = node.path("expires_in").asLong(0);
        if (expires <= 0) {
            throw failure(false);
        }
        List<String> scopes = new ArrayList<>();
        JsonNode functions = node.path("func_info");
        if (functions.isArray()) {
            functions.forEach(item -> {
                JsonNode id = item.path("funcscope_category").path("id");
                if (id.canConvertToInt()) {
                    scopes.add(Integer.toString(id.intValue()));
                }
            });
        }
        return new AuthorizerToken(appid, accessToken, refreshToken, String.join(",", scopes),
            new Date(System.currentTimeMillis() + Duration.ofSeconds(expires).toMillis()));
    }

    private JsonNode object(String... values) {
        var node = objectMapper.createObjectNode();
        for (int index = 0; index < values.length; index += 2) {
            if (!StringUtils.hasText(values[index + 1])) {
                throw failure(false);
            }
            node.put(values[index], values[index + 1]);
        }
        return node;
    }

    private JsonNode requiredObject(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (!value.isObject()) {
            throw failure(false);
        }
        return value;
    }

    private String requiredText(JsonNode node, String field) {
        String value = text(node, field);
        if (!StringUtils.hasText(value)) {
            throw failure(false);
        }
        return value;
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isTextual() ? value.textValue() : null;
    }

    private byte[] readBounded(InputStream input) throws IOException {
        if (input == null) {
            throw failure(false);
        }
        try (input) {
            byte[] bytes = input.readNBytes(MAX_RESPONSE_BYTES + 1);
            if (bytes.length > MAX_RESPONSE_BYTES) {
                throw failure(false);
            }
            return bytes;
        }
    }

    private void close(InputStream input) {
        if (input == null) {
            return;
        }
        try {
            input.close();
        } catch (IOException ignored) {
            // The provider body is deliberately discarded.
        }
    }

    private WeixinOpenPlatformClientException failure(boolean timeout) {
        return new WeixinOpenPlatformClientException(
            timeout ? "Weixin Open Platform request timed out" : "Weixin Open Platform request failed", timeout);
    }
}
